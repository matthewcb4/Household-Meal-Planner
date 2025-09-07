// index.js (Cloud Functions) - Updated with App Check Enforcement and full Stripe Webhook logic

const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");
const { GoogleAuth } = require("google-auth-library");
const admin = require("firebase-admin");
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const stripePackage = require('stripe');
const ics = require('ics');

admin.initializeApp();
const db = admin.firestore();

// --- Define non-Stripe secrets and environment variables at the top ---
const pexelsKey = defineString("PEXELS_KEY");
const documentAiProcessorId = defineString("DOCUMENT_AI_PROCESSOR_ID");
const documentAiLocation = defineString("DOCUMENT_AI_LOCATION");
const stripePriceId = defineString("STRIPE_PRICE_ID");


// --- HELPER: Check for Premium Status (Handles Trials & Subscriptions) ---
const isPremium = (householdData) => {
    if (!householdData || householdData.subscriptionTier !== 'paid') {
        return false;
    }
    if (householdData.premiumAccessUntil) {
        const now = new Date();
        const expiryDate = householdData.premiumAccessUntil.toDate();
        if (now >= expiryDate) {
            return false;
        }
    }
    return true;
};


// --- HELPER: Pexels Image Fetching Function ---
const getPexelsImage = async (query) => {
    try {
        const apiKey = pexelsKey.value();
        if (!apiKey) {
            console.error("Pexels API key is not set as a secret.");
            return null;
        }
        const enhancedQuery = `${query} food`;
        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(enhancedQuery)}&per_page=1`;
        const response = await fetch(url, {
            headers: { 'Authorization': apiKey }
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Pexels API error: ${response.statusText} for query "${enhancedQuery}"`, errorBody);
            return null;
        }
        const data = await response.json();
        const imageUrl = data?.photos?.[0]?.src?.large;
        if (imageUrl) {
            return imageUrl;
        }
        return null;
    } catch (error) {
        console.error(`Error fetching image from Pexels for query "${query}":`, error);
        return null;
    }
};

// --- CONSTANT: Define the AI model name ---
const GEMINI_MODEL_NAME = "gemini-2.5-flash-lite";

// Helper function to add a timeout to fetch calls
const fetchWithTimeout = async (url, options, timeout = 530000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(id);
    }
};

// --- HELPER: Delay function ---
const delay = ms => new Promise(res => setTimeout(res, ms));

// --- MODIFIED: Generic Usage Quota Management for daily limits ---
const checkAndIncrementUsage = async (householdId, feature, timezone = 'UTC') => {
    const householdRef = db.collection('households').doc(householdId);
    const householdDoc = await householdRef.get();
    const householdData = householdDoc.data();

    const isPremiumUser = isPremium(householdData);

    // UPDATED LIMITS
    const LIMITS = {
        scan: { free: 20, premium: 100 },
        recipeGeneration: { free: 5, premium: 10 }
    };

    const limit = isPremiumUser ? LIMITS[feature].premium : LIMITS[feature].free;

    // UPDATED: Use timezone to determine the current date for the user
    const now = new Date();
    const todayDateString = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD format

    const usage = householdData.usage || {};
    const featureUsage = usage[feature] || { count: 0, date: '' };
    
    let currentCount = featureUsage.count;

    // If the last usage date string is not today's date string, reset the count.
    if (featureUsage.date !== todayDateString) {
        currentCount = 0;
    }

    if (currentCount >= limit) {
        return { allowed: false, limit: limit, remaining: 0, isPremium: isPremiumUser };
    }

    const newCount = currentCount + 1;
    
    // Update Firestore, preserving other feature usage data
    await householdRef.set({
        usage: {
            ...usage,
            [feature]: {
                count: newCount,
                date: todayDateString
            }
        }
    }, { merge: true });
    
    const remaining = limit - newCount;
    return { allowed: true, limit: limit, remaining: remaining, isPremium: isPremiumUser };
};


// --- CLOUD FUNCTION (V2): identifyItems ---
exports.identifyItems = onCall({ timeoutSeconds: 540, region: "us-central1", enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const householdId = userDoc.data()?.householdId;
    if (!householdId) {
        throw new HttpsError('failed-precondition', 'User is not part of a household.');
    }
    
    // UPDATED to pass timezone
    const timezone = request.data.timezone || 'UTC';
    const usageCheck = await checkAndIncrementUsage(householdId, 'scan', timezone);
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your free scans for the day.`);
    }
    
    const base64ImageData = request.data.image;
    
    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        const prompt = `Identify all distinct food items in this image. For each item, determine its most likely category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Respond with a single, valid JSON array of objects, where each object has a "name" and a "category" key. For example: [{"name": "apple", "category": "Produce"}, {"name": "ground beef", "category": "Meat & Seafood"}].`;
        
        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64ImageData } }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aiRequest),
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            console.error("AI API Error Response:", errorText);
            throw new HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }

        const responseData = await aiResponse.json();
        
        if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts.length > 0) {
            const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            const items = JSON.parse(jsonTextResponse);
            return items;
        } else {
            if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].finishReason === 'SAFETY') {
                 throw new HttpsError('invalid-argument', 'The request was blocked due to safety concerns. Please try a different image.');
            }
            throw new HttpsError('internal', 'Failed to parse the response from the AI service.');
        }
    } catch (error) {
        console.error("Internal Function Error in identifyItems:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', "AI processing failed due to an internal error.");
    }
});

// --- CLOUD FUNCTION (V2): suggestRecipes ---
exports.suggestRecipes = onCall({ timeoutSeconds: 540, region: "us-central1", enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const householdId = userDoc.data()?.householdId;
    if (!householdId) {
        throw new HttpsError('failed-precondition', 'User is not part of a household.');
    }
    
    const { pantryItems, mealType, cuisine, criteria, unitSystem, timezone } = request.data;
    const usageCheck = await checkAndIncrementUsage(householdId, 'recipeGeneration', timezone);
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your AI recipe suggestions for the day.`);
    }

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;
        
        let prompt = `You are a helpful chef. Given the following list of pantry ingredients, suggest about 5 ${mealType} recipes.`;
        if (cuisine) prompt += ` The user prefers ${cuisine} cuisine.`;
        
        const otherCriteria = [];
        if (criteria && criteria.length > 0) {
             if (criteria.includes("Quick Meal (<30 minutes)")) {
                prompt += ` The recipes should also be quick to make, taking less than 30 minutes.`;
            } else {
                otherCriteria.push(criteria.filter(c => c !== "Quick Meal (<30 minutes)"));
            }
            if(otherCriteria.length > 0) {
                prompt += ` The recipes should also meet the following criteria: ${otherCriteria.join(', ')}.`;
            }
        }

        prompt += ` Include a mix of 3 simple recipes and 3 more complex recipes. For each recipe, provide a title, a brief description, a list of ingredients, a single, simple keyword for an image search query, and a step-by-step list of cooking instructions. Also include an estimated nutritional information object containing calories, protein, carbs, and fat as strings (e.g., "450 kcal", "30g"). For each ingredient, provide its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Format your entire response as a single, valid JSON array of objects. Each recipe object should have "title", "description", "ingredients", "imageQuery", "instructions", and "nutrition" as keys. The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys. Pantry ingredients: ${pantryItems.join(", ")}`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };
        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aiRequest),
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }
        const responseData = await aiResponse.json();
        
        if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts.length > 0) {
            const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            const recipes = JSON.parse(jsonTextResponse);
            for (const recipe of recipes) {
                recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);
            }
            return {
                recipes: recipes,
                remaining: usageCheck.remaining,
                isPremium: usageCheck.isPremium
            };
        } else {
            throw new HttpsError('internal', 'Failed to parse the response from the AI service.');
        }

    } catch (error) {
        console.error("Internal Recipe Function Error:", error);
        throw new HttpsError('internal', "AI recipe generation failed.");
    }
});

// --- CLOUD FUNCTION (V2): discoverRecipes ---
exports.discoverRecipes = onCall({ timeoutSeconds: 540, region: "us-central1", enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const householdId = userDoc.data()?.householdId;
    if (!householdId) {
        throw new HttpsError('failed-precondition', 'User is not part of a household.');
    }

    const { mealType, cuisine, criteria, unitSystem, timezone } = request.data;
    const usageCheck = await checkAndIncrementUsage(householdId, 'recipeGeneration', timezone);
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your AI recipe suggestions for the day.`);
    }

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        let prompt = `You are a helpful chef. Suggest 6 popular and delicious ${mealType} recipes.`;
        if (cuisine) prompt += ` The user prefers ${cuisine} cuisine.`;
        
        const otherCriteria = [];
        if (criteria && criteria.length > 0) {
             if (criteria.includes("Quick Meal (<30 minutes)")) {
                prompt += ` The recipes should also be quick to make, taking less than 30 minutes.`;
            } else {
                otherCriteria.push(criteria.filter(c => c !== "Quick Meal (<30 minutes)"));
            }
            if(otherCriteria.length > 0) {
                prompt += ` The recipes should also meet the following criteria: ${otherCriteria.join(', ')}.`;
            }
        }
        prompt += ` Include a mix of simple and more complex options. For each recipe, provide a title, a brief description, a list of ingredients, a single, simple keyword for an image search query, a step-by-step list of cooking instructions, and an estimated nutritional information object containing calories, protein, carbs, and fat as strings (e.g., "450 kcal", "30g"). For each ingredient, provide its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Format your entire response as a single, valid JSON array of objects. Each recipe object should have "title", "description", "ingredients", "imageQuery", "instructions", and "nutrition" as keys. The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys.`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };
        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aiRequest),
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }
        const responseData = await aiResponse.json();
        
        if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts.length > 0) {
            const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            const recipes = JSON.parse(jsonTextResponse);
            for (const recipe of recipes) {
                recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);
            }
            return {
                recipes: recipes,
                remaining: usageCheck.remaining,
                isPremium: usageCheck.isPremium
            };
        } else {
            throw new HttpsError('internal', 'Failed to parse the response from the AI service.');
        }

    } catch (error) {
        console.error("Internal Discover Function Error:", error);
        throw new HttpsError('internal', "AI recipe discovery failed.");
    }
});

// --- CLOUD FUNCTION (V2): askTheChef ---
exports.askTheChef = onCall({ timeoutSeconds: 540, region: "us-central1", enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const householdId = userDoc.data()?.householdId;
    if (!householdId) {
        throw new HttpsError('failed-precondition', 'User is not part of a household.');
    }
    
    const { mealQuery, unitSystem, timezone } = request.data;
    const usageCheck = await checkAndIncrementUsage(householdId, 'recipeGeneration', timezone);
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your AI recipe suggestions for the day.`);
    }

    if (!mealQuery) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "mealQuery".');
    }

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        const prompt = `You are an expert chef. A user wants a recipe for "${mealQuery}". Provide a single, detailed recipe for this meal.
        For the recipe, provide a title, a brief description, a list of all necessary ingredients, a simple image search keyword, step-by-step cooking instructions, and an estimated nutritional information object containing calories, protein, carbs, and fat as strings (e.g., "450 kcal", "30g").
        For each ingredient, provide its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"].
        Format your entire response as a single, valid JSON object with "title", "description", "ingredients", "imageQuery", "instructions", and "nutrition" as keys.
        The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys.`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aiRequest),
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }

        const responseData = await aiResponse.json();
        
        if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts.length > 0) {
            const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            const recipe = JSON.parse(jsonTextResponse);
            recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);
            return {
                recipe: recipe,
                remaining: usageCheck.remaining,
                isPremium: usageCheck.isPremium
            };
        } else {
            throw new HttpsError('internal', 'Failed to parse the response from the AI service.');
        }

    } catch (error) {
        console.error("Internal Ask the Chef Function Error:", error);
        throw new HttpsError('internal', "AI recipe generation failed for the specified query.");
    }
});


// --- CLOUD FUNCTION (V2): importRecipeFromUrl ---
exports.importRecipeFromUrl = onCall({ timeoutSeconds: 540, region: "us-central1", enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const householdId = userDoc.data()?.householdId;
    if (!householdId) {
        throw new HttpsError('failed-precondition', 'User is not part of a household.');
    }

    const { url, unitSystem, timezone } = request.data;
    const usageCheck = await checkAndIncrementUsage(householdId, 'recipeGeneration', timezone);
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your AI recipe suggestions for the day.`);
    }

    if (!url) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "url".');
    }

    try {
        const pageResponse = await fetch(url);
        if (!pageResponse.ok) {
            throw new HttpsError('not-found', `Could not fetch the content from the URL: ${url}`);
        }
        const htmlContent = await pageResponse.text();

        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;
        
        const prompt = `From the following HTML content, extract the recipe. Provide a title, a brief description, all ingredients, step-by-step cooking instructions, a simple image search keyword, and estimated nutritional information (calories, protein, carbs, fat). For each ingredient, extract its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and categorize it from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Your entire response MUST be ONLY the resulting valid JSON object, starting with { and ending with }, without any surrounding text, comments, or markdown code fences like \`\`\`json. The JSON object must contain these exact keys: "title", "description", "ingredients", "imageQuery", "instructions", and "nutrition". The "ingredients" value must be an array of objects. The "instructions" value must be an array of strings. HTML content: ${htmlContent}`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aiRequest),
        });
        
        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new HttpsError('internal', `AI API request failed with status ${aiResponse.status}: ${errorText}`);
        }

        const responseData = await aiResponse.json();

        if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts.length > 0) {
            let jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            let recipe;
            try {
                // Find the start of the JSON object
                const jsonStart = jsonTextResponse.indexOf('{');
                if (jsonStart === -1) {
                    throw new Error("Response does not contain a JSON object.");
                }

                // Find the end of the JSON object by balancing curly braces
                let braceCount = 0;
                let jsonEnd = -1;
                for (let i = jsonStart; i < jsonTextResponse.length; i++) {
                    if (jsonTextResponse[i] === '{') {
                        braceCount++;
                    } else if (jsonTextResponse[i] === '}') {
                        braceCount--;
                    }
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }

                if (jsonEnd === -1) {
                    throw new Error("Could not find the end of the JSON object.");
                }
                
                const jsonString = jsonTextResponse.substring(jsonStart, jsonEnd);
                recipe = JSON.parse(jsonString);

            } catch (parseError) {
                console.error("Failed to parse JSON from AI response:", jsonTextResponse, parseError);
                throw new HttpsError('internal', 'The AI returned a recipe in an invalid format. Please try another URL.');
            }
            
            recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);
            return {
                recipe: recipe,
                remaining: usageCheck.remaining,
                isPremium: usageCheck.isPremium
            };
        } else {
             console.error("Invalid response structure from AI:", JSON.stringify(responseData, null, 2));
            throw new HttpsError('internal', 'Failed to parse the recipe from the provided URL. The response from the AI was empty or invalid.');
        }

    } catch (error) {
        console.error("Internal Recipe Import Function Error:", error);
        // Pass the original error message if it's an HttpsError, otherwise use a generic message
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', "AI recipe import failed.");
    }
});


// --- CLOUD FUNCTION (V2): generateGroceryList ---
exports.generateGroceryList = onCall({ enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in to generate a grocery list.');
    }
    
    const { weekId } = request.data;
    if (!weekId) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "weekId".');
    }

    try {
        const userDoc = await db.collection('users').doc(request.auth.uid).get();
        const householdId = userDoc.data().householdId;

        if (!householdId) {
            throw new HttpsError('failed-precondition', 'User is not part of a household.');
        }

        const mealPlanRef = db.collection('households').doc(householdId).collection('mealPlan').doc(weekId);
        const mealPlanDoc = await mealPlanRef.get();

        if (!mealPlanDoc.exists) {
            return { success: true, message: "No meal plan found for this week. Grocery list is empty." };
        }

        const neededIngredients = new Map();
        const plan = mealPlanDoc.data().meals;

        for (const day in plan) {
            for (const meal in plan[day]) {
                for (const recipeId in plan[day][meal]) {
                    const recipe = plan[day][meal][recipeId];
                    if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
                        recipe.ingredients.forEach(ing => {
                            let name, category = 'Other';
                            if (typeof ing === 'object' && ing.name) {
                                name = ing.name.toLowerCase().trim();
                                category = ing.category || 'Other';
                            } else {
                                name = String(ing).replace(/^[0-9.\\s/]+(lbs?|oz|g|kg|cups?|tbsps?)?\\s*/i, '').toLowerCase().trim();
                            }
                            
                            if (name) {
                                neededIngredients.set(name, { name, category });
                            }
                        });
                    }
                }
            }
        }

        const pantrySnapshot = await db.collection('households').doc(householdId).collection('pantryItems').get();
        const pantryItems = new Set(pantrySnapshot.docs.map(doc => doc.data().name.toLowerCase().trim()));

        const groceryListRef = db.collection('households').doc(householdId).collection('groceryListItems');
        const groceryListSnapshot = await groceryListRef.get();
        const existingGroceryItems = new Set(groceryListSnapshot.docs.map(doc => doc.data().name.toLowerCase().trim()));

        const batch = db.batch();
        let itemsAdded = 0;

        neededIngredients.forEach((ingredient, name) => {
            if (!pantryItems.has(name) && !existingGroceryItems.has(name)) {
                const newItemRef = groceryListRef.doc();
                batch.set(newItemRef, {
                    name: ingredient.name,
                    category: ingredient.category,
                    checked: false,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                itemsAdded++;
            }
        });

        if (itemsAdded > 0) {
            await batch.commit();
        }

        return { success: true, message: `Successfully added ${itemsAdded} new item(s) to your grocery list.` };

    } catch (error) {
        console.error("Error generating grocery list:", error);
        throw new HttpsError('internal', 'Failed to generate grocery list.');
    }
});

// --- CLOUD FUNCTION (V2): planSingleDay ---
exports.planSingleDay = onCall({ timeoutSeconds: 540, region: "us-central1", enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }

    const { day, criteria, pantryItems, existingMeals, unitSystem } = request.data;
    if (!day) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "day".');
    }

    try {
        const userDoc = await db.collection('users').doc(request.auth.uid).get();
        const householdId = userDoc.data()?.householdId;
        if (!householdId) {
            throw new HttpsError('failed-precondition', 'User is not part of a household.');
        }

        const mealsToPlan = [];
        if (!existingMeals?.breakfast) mealsToPlan.push("Breakfast");
        if (!existingMeals?.lunch) mealsToPlan.push("Lunch");
        if (!existingMeals?.dinner) mealsToPlan.push("Dinner");

        if (mealsToPlan.length === 0) {
            return {};
        }

        const householdDoc = await db.collection('households').doc(householdId).get();
        const householdData = householdDoc.data();

        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        const cuisines = ["Italian", "Mexican", "Asian", "American", "Mediterranean", "Indian"];
        let requestedCuisine = null;
        const otherCriteria = [];

        if (criteria && Array.isArray(criteria)) {
            for (let i = criteria.length - 1; i >= 0; i--) {
                const c = criteria[i];
                if (cuisines.includes(c) && !requestedCuisine) {
                    requestedCuisine = c;
                } else {
                    otherCriteria.unshift(c);
                }
            }
        }
        
        const finalCuisine = requestedCuisine || householdData.cuisine || 'any';

        let prompt = `You are an expert meal planner. Create a meal plan for a single day, ${day}, with one recipe each for ${mealsToPlan.join(' and ')}.
        The user's preferred cuisine is ${finalCuisine}.`;

        if (otherCriteria.length > 0) {
            if (otherCriteria.includes("Quick Meal (<30 minutes)")) {
                prompt += ` The recipes must also be quick to make, taking less than 30 minutes.`;
            }
            const filteredCriteria = otherCriteria.filter(c => c !== "Quick Meal (<30 minutes)");
            if (filteredCriteria.length > 0) {
                prompt += ` The recipes must also meet the following criteria: ${filteredCriteria.join(', ')}.`;
            }
        }
        
        if (pantryItems && pantryItems.length > 0) {
            prompt += ` Please prioritize using ingredients from the user's pantry, which contains: ${pantryItems.join(', ')}. You can still include other ingredients, but try to use these first.`;
        }

        prompt += ` For each recipe, provide a title, a brief description, a list of ingredients (including quantity, unit in the ${unitSystem || 'imperial'} system, and category: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]), a simple image search keyword, step-by-step cooking instructions, and an estimated nutritional information object containing calories, protein, carbs, and fat as strings (e.g., "450 kcal", "30g").
        
        VERY IMPORTANT: Structure your response as a single, valid JSON object. The top-level keys should be the meal types you planned (e.g., "breakfast", "dinner").
        Each meal's value should be an object where the key is a unique meal ID (e.g., "meal_1700000000") and the value is the full recipe object.`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aiRequest),
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new HttpsError('internal', `Failed to generate plan for ${day}`);
        }

        const responseData = await aiResponse.json();
        
        if (!responseData.candidates || !responseData.candidates[0].content || !responseData.candidates[0].content.parts[0].text) {
            throw new HttpsError('internal', `Invalid AI response for ${day}`);
        }
        
        const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
        const dayPlan = JSON.parse(jsonTextResponse);

        for (const mealType in dayPlan) {
            for (const mealId in dayPlan[mealType]) {
                const recipe = dayPlan[mealType][mealId];
                if (recipe.imageQuery) {
                    recipe.imageUrl = await getPexelsImage(recipe.imageQuery);
                }
            }
        }
        return dayPlan;

    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', `An unexpected error occurred while planning ${day}.`);
    }
});


exports.scanReceipt = onCall({ timeoutSeconds: 540, region: "us-central1", enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const householdId = userDoc.data()?.householdId;
    if (!householdId) {
        throw new HttpsError('failed-precondition', 'User is not part of a household.');
    }

    const usageCheck = await checkAndIncrementUsage(householdId, 'scan');
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your free scans for the month.`);
    }

    const { image } = request.data;
    const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
    const location = documentAiLocation.value(); 
    const processorId = documentAiProcessorId.value();

    const client = new DocumentProcessorServiceClient({
        apiEndpoint: `${location}-documentai.googleapis.com`,
    });

    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

    const requestPayload = {
        name,
        rawDocument: {
            content: image,
            mimeType: 'image/jpeg',
        },
    };

    try {
        const [result] = await client.processDocument(requestPayload);
        const { document } = result;
        const { entities } = document;

        const lineItems = entities.filter(e => e.type === 'line_item');
        const itemNames = lineItems.map(item => item.mentionText.replace(/\\n/g, ' ').trim());
        
        if (itemNames.length === 0) {
            return [];
        }

        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        const prompt = `Given this list of grocery items from a receipt, categorize each item into one of the following: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Also, clean up the item names to be generic (e.g., "ORG BANANAS" becomes "bananas"). Respond with a single, valid JSON array of objects, where each object has a "name" and a "category" key. Item list: ${itemNames.join(', ')}`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aiRequest),
        });

        if (!aiResponse.ok) {
            throw new Error(`AI categorization failed with status ${aiResponse.status}`);
        }

        const responseData = await aiResponse.json();
        
        if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts.length > 0) {
            const items = JSON.parse(responseData.candidates[0].content.parts[0].text);
            return items;
        } else {
             throw new HttpsError('internal', 'Failed to parse the categorization response from the AI service.');
        }

    } catch (error) {
        console.error("Error in scanReceipt function:", error);
        throw new HttpsError('internal', 'Failed to process receipt.');
    }
});

// --- NEW/UPDATED FUNCTION: calendarFeed ---
const getWeekId = (date = new Date()) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const getStartOfWeek = (date = new Date()) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
};


exports.calendarFeed = onRequest({ cors: true }, async (req, res) => {
    const { householdId } = req.query;

    if (!householdId) {
        res.status(400).send("Missing required query parameter: householdId");
        return;
    }

    try {
        const events = [];
        const today = new Date();
        const numberOfWeeks = 5; // Current week + next 4 weeks

        for (let i = 0; i < numberOfWeeks; i++) {
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + (i * 7));
            
            const weekId = getWeekId(targetDate);
            const weekStartDate = getStartOfWeek(targetDate);

            const mealPlanRef = db.collection('households').doc(householdId).collection('mealPlan').doc(weekId);
            const mealPlanDoc = await mealPlanRef.get();

            if (mealPlanDoc.exists) {
                const plan = mealPlanDoc.data().meals || {};
                const dayIndexMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
                const mealTimes = { breakfast: 8, lunch: 13, dinner: 19 };

                for (const day in plan) {
                    const dayOffset = dayIndexMap[day];
                    if (dayOffset === undefined) continue;

                    const eventDate = new Date(weekStartDate);
                    eventDate.setDate(eventDate.getDate() + dayOffset);

                    for (const meal in plan[day]) {
                        const hour = mealTimes[meal];
                        if (hour === undefined) continue;

                        for (const recipeId in plan[day][meal]) {
                            const recipe = plan[day][meal][recipeId];
                            const event = {
                                title: `${meal.charAt(0).toUpperCase() + meal.slice(1)}: ${recipe.title}`,
                                start: [eventDate.getFullYear(), eventDate.getMonth() + 1, eventDate.getDate(), hour, 0],
                                duration: { hours: 1 },
                                description: `Recipe: ${recipe.title}\\n\\n${recipe.description || ''}`,
                                calName: 'Auto Meal Chef Plan',
                                productId: 'automchef/ics'
                            };
                            events.push(event);
                        }
                    }
                }
            }
        }

        const { error, value } = ics.createEvents(events);

        if (error) {
            console.error("Error creating ICS file:", error);
            res.status(500).send("Could not generate calendar file.");
            return;
        }

        res.setHeader('Content-Type', 'text/calendar');
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); // Cache for 1 hour
        res.status(200).send(value);

    } catch (error) {
        console.error("Error in calendarFeed function:", error);
        res.status(500).send("An internal error occurred.");
    }
});


// --- Stripe Cloud Functions (UPDATED FOR SUBSCRIPTIONS) ---

exports.createStripeCheckout = onCall({ enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in to make a purchase.');
    }

    const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);

    try {
        const uid = request.auth.uid;
        const userDoc = await db.collection('users').doc(uid).get();

        if (!userDoc.exists) {
            throw new HttpsError('not-found', 'Could not find user data.');
        }
        const householdId = userDoc.data().householdId;

        if (!householdId) {
            throw new HttpsError('failed-precondition', 'User is not part of a household.');
        }
        
        const price = stripePriceId.value();
        if (!price) {
            throw new HttpsError('internal', 'Stripe Price ID is not configured.');
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price: price,
                quantity: 1,
            }],
            mode: 'subscription', 
            success_url: `https://automchef.com?payment_success=true`,
            cancel_url: `https://automchef.com?payment_cancel=true`,
            // UPDATED: Pass metadata to the subscription for future reference in webhooks
            subscription_data: {
                metadata: {
                    householdId: householdId
                }
            },
            // Keep metadata on the session for the initial checkout.session.completed event
            metadata: {
                householdId: householdId
            }
        });

        return { id: session.id };

    } catch (error) {
        console.error("Error creating Stripe checkout session:", error);
        throw new HttpsError('internal', 'An error occurred while creating the checkout session.');
    }
});


exports.stripeWebhook = onRequest(async (req, res) => {
    const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);
    const signature = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, signature, endpointSecret);
    } catch (err) {
        console.log(`⚠️  Webhook signature verification failed.`, err.message);
        return res.sendStatus(400);
    }
    
    const grantAccess = async (householdId, customerId, subscriptionId) => {
        if (householdId) {
            const householdRef = db.collection('households').doc(householdId);
            const now = new Date();
            const accessEndDate = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);

            await householdRef.update({
                subscriptionTier: 'paid',
                premiumAccessUntil: admin.firestore.Timestamp.fromDate(accessEndDate),
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId
            });
            console.log(`Successfully granted premium access to household ${householdId}.`);
        }
    };
    
    // NEW: Helper function to revoke premium access
    const revokeAccess = async (householdId) => {
        if (!householdId) {
            console.error('Revoke access called without a householdId.');
            return;
        }
        const householdRef = db.collection('households').doc(householdId);
        await householdRef.update({
            subscriptionTier: 'free',
            premiumAccessUntil: admin.firestore.FieldValue.delete(),
            stripeCustomerId: admin.firestore.FieldValue.delete(),
            stripeSubscriptionId: admin.firestore.FieldValue.delete()
        });
        console.log(`Successfully revoked premium access for household ${householdId}.`);
    };

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const householdId = session.metadata.householdId;
            const customerId = session.customer;
            const subscriptionId = session.subscription;
            console.log(`Checkout session completed for household ${householdId}.`);
            await grantAccess(householdId, customerId, subscriptionId);
            break;
        }
        case 'invoice.payment_succeeded': {
            const invoice = event.data.object;
            if (invoice.subscription) {
                 const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
                 const householdId = subscription.metadata.householdId;
                 const customerId = subscription.customer;
                 console.log(`Recurring payment successful for household ${householdId}.`);
                 await grantAccess(householdId, customerId, subscription.id);
            }
            break;
        }
        // NEW: Handle failed payments to revoke access
        case 'invoice.payment_failed': {
            const invoice = event.data.object;
            if (invoice.subscription) {
                const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
                const householdId = subscription.metadata.householdId;
                if (householdId) {
                    console.log(`Payment failed for household ${householdId}. Revoking access.`);
                    await revokeAccess(householdId);
                }
            }
            break;
        }
        // NEW: Handle subscription cancellations to revoke access
        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            const householdId = subscription.metadata.householdId;
            if (householdId) {
                console.log(`Subscription deleted for household ${householdId}. Revoking access.`);
                await revokeAccess(householdId);
            } else {
                 console.error(`Could not find householdId in metadata for deleted subscription ${subscription.id}`);
            }
            break;
        }
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.status(200).send();
});

// --- CLOUD FUNCTION (V2): grantTrialAccess ---
exports.grantTrialAccess = onCall({ enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }

    const { householdIdToGrant } = request.data;
    if (!householdIdToGrant) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "householdIdToGrant".');
    }

    try {
        const householdRef = db.collection('households').doc(householdIdToGrant);
        const householdDoc = await householdRef.get();

        if (!householdDoc.exists()) {
            throw new HttpsError('not-found', `Household with ID ${householdIdToGrant} not found.`);
        }

        const now = new Date();
        const trialEndDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

        await householdRef.update({
            subscriptionTier: 'paid',
            premiumAccessUntil: admin.firestore.Timestamp.fromDate(trialEndDate)
        });

        return { success: true, message: `Trial granted until ${trialEndDate.toLocaleDateString()}.` };

    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'An error occurred while granting trial access.');
    }
});


// --- CLOUD FUNCTION (V2): checkTrialExpirations (Scheduled) ---
exports.checkTrialExpirations = onSchedule('every 24 hours', async (event) => {
    const now = admin.firestore.Timestamp.now();
    const expiredTrialsQuery = db.collection('households')
        .where('premiumAccessUntil', '<=', now);

    try {
        const snapshot = await expiredTrialsQuery.get();
        if (snapshot.empty) {
            console.log("No expired trials found.");
            return null;
        }

        const batch = db.batch();
        snapshot.forEach(doc => {
            console.log(`Trial expired for household ${doc.id}. Reverting to free tier.`);
            const householdRef = db.collection('households').doc(doc.id);
            batch.update(householdRef, {
                subscriptionTier: 'free',
                premiumAccessUntil: admin.firestore.FieldValue.delete()
            });
        });

        await batch.commit();
        return { success: true, processedCount: snapshot.size };

    } catch (error) {
        console.error("Error in checkTrialExpirations scheduled function:", error);
        return null;
    }
});

// --- Test Function for Stripe Secret ---
exports.testStripeSecret = onCall({ enforceAppCheck: true }, async (request) => {
    try {
        const key = process.env.STRIPE_SECRET_KEY;
        if (key && key.startsWith("sk_test_")) {
            return { success: true, keyStart: key.substring(0, 8) };
        } else if (key) {
            return { success: false, error: "Key is present but invalid." };
        } else {
            return { success: false, error: "Stripe secret key not found." };
        }
    } catch (error) {
        throw new HttpsError('internal', 'An error occurred while testing the secret.');
    }
});

// --- getCommunityRecipes (FIXED FOR TIMEZONES) ---
exports.getCommunityRecipes = onCall({ region: "us-central1", enforceAppCheck: true }, async (request) => {
    try {
        // 1. Get Today's & Yesterday's Suggestions to cover all timezones
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const yesterdayString = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        
        const suggestionsSnapshot = await db.collectionGroup('dailySuggestions').get();

        let recentRecipes = [];
        suggestionsSnapshot.forEach(doc => {
            // Filter for documents from today OR yesterday (server time)
            if (doc.id === todayString || doc.id === yesterdayString) {
                const data = doc.data();
                if (data.recipes && Array.isArray(data.recipes)) {
                    recentRecipes.push(...data.recipes);
                }
            }
        });

        // 2. Get Community Favorites
        const favoritesSnapshot = await db.collectionGroup('favoriteRecipes').get();
        let allFavorites = [];
        favoritesSnapshot.forEach(doc => {
            allFavorites.push({ id: doc.id, ...doc.data() });
        });

        // Sort by rating in the function, then take the top 10
        const favoriteRecipes = allFavorites
            .filter(recipe => recipe.rating && recipe.rating > 0) // Ensure there's a rating
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 10);

        return {
            todayRecipes: recentRecipes.slice(0, 10), // Limit to 10 for today as well
            favoriteRecipes: favoriteRecipes
        };

    } catch (error) {
        console.error("Error in getCommunityRecipes:", error);
        throw new HttpsError('internal', 'Could not fetch community recipes.');
    }
});