// index.js (Cloud Functions) - Updated to V2 Syntax with Subscription Logic

const functions = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
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
// --- NEW: Add your Stripe Price ID as a secret/param ---
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
    // If subscriptionTier is 'paid' but there's no expiration, it's a legacy permanent plan.
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

        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`;
        const response = await fetch(url, {
            headers: { 'Authorization': apiKey }
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Pexels API error: ${response.statusText} for query "${query}"`, errorBody);
            return null;
        }

        const data = await response.json();
        
        const imageUrl = data?.photos?.[0]?.src?.large;
        if (imageUrl) {
            return imageUrl;
        }
        
        if (data?.photos?.length > 0) {
            console.warn(`Pexels API response for query "${query}" had a photo but was missing the expected 'src.large' path.`, JSON.stringify(data.photos[0]));
        }

        return null;
    } catch (error) {
        console.error(`Error fetching image from Pexels for query "${query}":`, error);
        return null;
    }
};

// --- CONSTANT: Define the AI model name ---
const GEMINI_MODEL_NAME = "gemini-2.5-flash";

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

// --- SCAN QUOTA MANAGEMENT (UPDATED to use isPremium helper) ---
const checkScanQuota = async (householdId) => {
    const householdRef = db.collection('households').doc(householdId);
    const householdDoc = await householdRef.get();
    const householdData = householdDoc.data();

    if (isPremium(householdData)) {
        return { allowed: true };
    }

    const usage = householdData.scanUsage || { count: 0, resetDate: new Date(0) };
    const now = new Date();
    const resetDate = usage.resetDate.toDate ? usage.resetDate.toDate() : usage.resetDate;

    if (now > resetDate) {
        usage.count = 0;
    }

    const FREE_SCAN_LIMIT = 20;
    if (usage.count >= FREE_SCAN_LIMIT) {
        return { allowed: false, limit: FREE_SCAN_LIMIT };
    }
    return { allowed: true };
};

const incrementScanUsage = async (householdId) => {
    const householdRef = db.collection('households').doc(householdId);
    const householdDoc = await householdRef.get();
    const householdData = householdDoc.data();

    if (isPremium(householdData)) {
        return; // Don't increment for premium users
    }
    
    const usage = householdData.scanUsage || { count: 0, resetDate: new Date(0) };
    const now = new Date();
    const resetDate = usage.resetDate.toDate ? usage.resetDate.toDate() : usage.resetDate;

    if (now > resetDate) {
        usage.count = 1;
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        usage.resetDate = admin.firestore.Timestamp.fromDate(nextMonth);
    } else {
        usage.count += 1;
    }
    
    await householdRef.update({ scanUsage: usage });
};


// --- CLOUD FUNCTION (V2): identifyItems ---
exports.identifyItems = onCall({ timeoutSeconds: 540, region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const householdId = userDoc.data()?.householdId;
    if (!householdId) {
        throw new HttpsError('failed-precondition', 'User is not part of a household.');
    }

    const quotaCheck = await checkScanQuota(householdId);
    if (!quotaCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${quotaCheck.limit} of your free scans for the month.`);
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
            if (items.length > 0) {
                await incrementScanUsage(householdId);
            }
            return items;
        } else {
            console.error("Unexpected AI API response structure:", JSON.stringify(responseData));
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
exports.suggestRecipes = onCall({ timeoutSeconds: 540, region: "us-central1" }, async (request) => {
    const { pantryItems, mealType, cuisine, criteria, unitSystem } = request.data;

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;
        
        let prompt = `You are a helpful chef. Given the following list of pantry ingredients, suggest about 5 ${mealType} recipes.`;
        if (cuisine) prompt += ` The user prefers ${cuisine} cuisine.`;
        if (criteria && criteria.length > 0) prompt += ` The recipes should also meet the following criteria: ${criteria.join(', ')}.`;
        prompt += ` Include a mix of 2-3 simple recipes and 2-3 more complex recipes. For each recipe, provide a title, a brief description, a list of ingredients, a single, simple keyword for an image search query, and a step-by-step list of cooking instructions. For each ingredient, provide its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Format your entire response as a single, valid JSON array of objects. Each recipe object should have "title", "description", "ingredients", "imageQuery", and "instructions" as keys. The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys. Pantry ingredients: ${pantryItems.join(", ")}`;

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
            console.error("AI Recipe API Error Response:", errorText);
            throw new HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }
        const responseData = await aiResponse.json();
        
        if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts.length > 0) {
            const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            const recipes = JSON.parse(jsonTextResponse);
            for (const recipe of recipes) {
                recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);
            }
            return recipes;
        } else {
            console.error("Unexpected AI API response structure:", JSON.stringify(responseData));
            throw new HttpsError('internal', 'Failed to parse the response from the AI service.');
        }

    } catch (error) {
        console.error("Internal Recipe Function Error:", error);
        throw new HttpsError('internal', "AI recipe generation failed.");
    }
});

// --- CLOUD FUNCTION (V2): discoverRecipes ---
exports.discoverRecipes = onCall({ timeoutSeconds: 540, region: "us-central1" }, async (request) => {
    const { mealType, cuisine, criteria, unitSystem } = request.data;

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        let prompt = `You are a helpful chef. Suggest 5 popular and delicious ${mealType} recipes.`;
        if (cuisine) prompt += ` The user prefers ${cuisine} cuisine.`;
        if (criteria && criteria.length > 0) prompt += ` The recipes should also meet the following criteria: ${criteria.join(', ')}.`;
        prompt += ` Include a mix of simple and more complex options. For each recipe, provide a title, a brief description, a list of ingredients, a single, simple keyword for an image search query, and a step-by-step list of cooking instructions. For each ingredient, provide its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Format your entire response as a single, valid JSON array of objects. Each recipe object should have "title", "description", "ingredients", "imageQuery", and "instructions" as keys. The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys.`;

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
            console.error("AI Discover API Error Response:", errorText);
            throw new HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }
        const responseData = await aiResponse.json();
        
        if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts.length > 0) {
            const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            const recipes = JSON.parse(jsonTextResponse);
            for (const recipe of recipes) {
                recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);
            }
            return recipes;
        } else {
            console.error("Unexpected AI API response structure:", JSON.stringify(responseData));
            throw new HttpsError('internal', 'Failed to parse the response from the AI service.');
        }

    } catch (error) {
        console.error("Internal Discover Function Error:", error);
        throw new HttpsError('internal', "AI recipe discovery failed.");
    }
});

// --- CLOUD FUNCTION (V2): askTheChef ---
exports.askTheChef = onCall({ timeoutSeconds: 180, region: "us-central1" }, async (request) => {
    const { mealQuery, unitSystem } = request.data;
    if (!mealQuery) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "mealQuery".');
    }

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        const prompt = `You are an expert chef. A user wants a recipe for "${mealQuery}". Provide a single, detailed recipe for this meal.
        For the recipe, provide a title, a brief description, a list of all necessary ingredients, a simple image search keyword, and step-by-step cooking instructions.
        For each ingredient, provide its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"].
        Format your entire response as a single, valid JSON object with "title", "description", "ingredients", "imageQuery", and "instructions" as keys.
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
            console.error("AI Ask the Chef Error Response:", errorText);
            throw new HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }

        const responseData = await aiResponse.json();
        
        if (responseData.candidates && responseData.candidates.length > 0 && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts.length > 0) {
            const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            const recipe = JSON.parse(jsonTextResponse);
            recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);
            return recipe;
        } else {
            console.error("Unexpected AI API response structure:", JSON.stringify(responseData));
            throw new HttpsError('internal', 'Failed to parse the response from the AI service.');
        }

    } catch (error) {
        console.error("Internal Ask the Chef Function Error:", error);
        throw new HttpsError('internal', "AI recipe generation failed for the specified query.");
    }
});


// --- CLOUD FUNCTION (V2): generateGroceryList ---
exports.generateGroceryList = onCall(async (request) => {
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
exports.planSingleDay = onCall({ timeoutSeconds: 180, region: "us-central1" }, async (request) => {
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
            console.log(`All meals for ${day} are already planned. Skipping.`);
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
            prompt += ` The recipes must also meet the following criteria: ${otherCriteria.join(', ')}.`;
        }
        
        if (pantryItems && pantryItems.length > 0) {
            prompt += ` Please prioritize using ingredients from the user's pantry, which contains: ${pantryItems.join(', ')}. You can still include other ingredients, but try to use these first.`;
        }

        prompt += ` For each recipe, provide a title, a brief description, a list of ingredients (including quantity, unit in the ${unitSystem || 'imperial'} system, and category: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]), a simple image search keyword, and step-by-step cooking instructions.
        
        VERY IMPORTANT: Structure your response as a single, valid JSON object. The top-level keys should be the meal types you planned (e.g., "breakfast", "dinner").
        Each meal's value should be an object where the key is a unique meal ID (e.g., "meal_1700000000") and the value is the full recipe object.
        
        Example for planning Breakfast and Dinner: { "breakfast": { "meal_12345": { "title": "Scrambled Eggs", "description": "Classic...", "ingredients": [{"name": "Eggs", "quantity": 2, "unit": "", "category": "Dairy & Eggs"}], "imageQuery": "scrambled eggs", "instructions": ["..."] } }, "dinner": { "meal_67890": { "title": "...", ... } } }`;

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
            console.error(`AI planSingleDay Error for ${day}:`, errorText);
            throw new HttpsError('internal', `Failed to generate plan for ${day}`);
        }

        const responseData = await aiResponse.json();
        
        if (!responseData.candidates || !responseData.candidates[0].content || !responseData.candidates[0].content.parts[0].text) {
            console.error(`Invalid AI response structure for ${day}:`, responseData);
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
        console.error(`planSingleDay function error for ${day}:`, error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', `An unexpected error occurred while planning ${day}.`);
    }
});


exports.scanReceipt = onCall({ timeoutSeconds: 540, region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const householdId = userDoc.data()?.householdId;
    if (!householdId) {
        throw new HttpsError('failed-precondition', 'User is not part of a household.');
    }

    const quotaCheck = await checkScanQuota(householdId);
    if (!quotaCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${quotaCheck.limit} of your free scans for the month.`);
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
            if (items.length > 0) {
                await incrementScanUsage(householdId);
            }
            return items;
        } else {
             console.error("Unexpected AI API response structure in scanReceipt:", JSON.stringify(responseData));
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
                                description: `Recipe: ${recipe.title}\n\n${recipe.description || ''}`,
                                calName: 'Household Meal Plan',
                                productId: 'household-meal-planner/ics'
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

exports.createStripeCheckout = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in to make a purchase.');
    }

    const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);

    try {
        const uid = request.auth.uid;
        const userDoc = await db.collection('users').doc(uid).get();

        if (!userDoc.exists) {
            console.error(`User document not found for uid: ${uid}`);
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
            success_url: `https://householdmealplanner.online?payment_success=true`,
            cancel_url: `https://householdmealplanner.online?payment_cancel=true`,
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
    
    if (event.type === 'invoice.payment_succeeded') {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const householdId = subscription.metadata.householdId;

        if (householdId) {
            const householdRef = db.collection('households').doc(householdId);
            const now = new Date();
            const accessEndDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

            await householdRef.update({
                subscriptionTier: 'paid',
                premiumAccessUntil: admin.firestore.Timestamp.fromDate(accessEndDate),
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscription.id
            });
            console.log(`Successfully granted 30-day premium access to household ${householdId}.`);
        }
    }

    res.status(200).send();
});

// --- NEW CLOUD FUNCTION (V2): grantTrialAccess ---
// This function is for you to manually grant trial access to beta testers.
exports.grantTrialAccess = onCall(async (request) => {
    // SECURITY NOTE: In a real app, you would add checks here to ensure only an admin can run this.
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

        if (!householdDoc.exists) {
            throw new HttpsError('not-found', `Household with ID ${householdIdToGrant} not found.`);
        }

        const now = new Date();
        const trialEndDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

        await householdRef.update({
            subscriptionTier: 'paid', // Treat them as 'paid' during the trial
            premiumAccessUntil: admin.firestore.Timestamp.fromDate(trialEndDate)
        });

        console.log(`Granted 30-day premium trial to household ${householdIdToGrant}. Expires on ${trialEndDate.toISOString()}`);
        return { success: true, message: `Trial granted until ${trialEndDate.toLocaleDateString()}.` };

    } catch (error) {
        console.error("Error in grantTrialAccess function:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'An error occurred while granting trial access.');
    }
});


// --- NEW CLOUD FUNCTION (V2): checkTrialExpirations (Scheduled) ---
// This function will run automatically every 24 hours to check for and revoke expired trials.
exports.checkTrialExpirations = onSchedule('every 24 hours', async (event) => {
    console.log("Running scheduled job to check for expired premium trials...");

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
                premiumAccessUntil: admin.firestore.FieldValue.delete() // Remove the field
            });
        });

        await batch.commit();
        console.log(`Successfully processed ${snapshot.size} expired trials.`);
        return { success: true, processedCount: snapshot.size };

    } catch (error) {
        console.error("Error in checkTrialExpirations scheduled function:", error);
        return null;
    }
});

// --- NEW: Test Function for Stripe Secret ---
exports.testStripeSecret = onCall(async (request) => {
    try {
        const key = process.env.STRIPE_SECRET_KEY;
        if (key && key.startsWith("sk_test_")) {
            console.log("Successfully loaded Stripe secret key.");
            return { success: true, keyStart: key.substring(0, 8) };
        } else if (key) {
            console.error("Stripe secret key is present but does not look like a test key.");
            return { success: false, error: "Key is present but invalid." };
        } else {
            console.error("Stripe secret key is missing from environment.");
            return { success: false, error: "Stripe secret key not found." };
        }
    } catch (error) {
        console.error("Error in testStripeSecret function:", error);
        throw new HttpsError('internal', 'An error occurred while testing the secret.');
    }
});