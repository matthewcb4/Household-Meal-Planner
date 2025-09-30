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

// --- Define secrets and environment variables at the top ---
const pexelsKey = defineString("PEXELS_KEY");
const documentAiProcessorId = defineString("DOCUMENT_AI_PROCESSOR_ID");
const documentAiLocation = defineString("DOCUMENT_AI_LOCATION");
const stripePriceId = defineString("STRIPE_PRICE_ID");
const stripeSecretKey = defineString("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineString("STRIPE_WEBHOOK_SECRET");
const unsplashAccessKey = defineString("UNSPLASH_ACCESS_KEY");


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

// --- NEW HELPER: Unsplash Image Fetching Function ---
const getUnsplashImage = async (query) => {
    try {
        const accessKey = unsplashAccessKey.value();
        if (!accessKey) {
            console.error("Unsplash Access Key is not configured.");
            return null;
        }
        // Enhance the query for better results
        const enhancedQuery = `${query} food`;
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(enhancedQuery)}&per_page=1`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Client-ID ${accessKey}` }
        });

        if (!response.ok) {
            console.error(`Unsplash API error: ${response.statusText}`);
            return null;
        }
        const data = await response.json();
        return data?.results?.[0]?.urls?.regular || null;
    } catch (error) {
        console.error(`Error fetching image from Unsplash for query "${query}":`, error);
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
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        const prompt = `Identify all distinct food items in this image. For each item, determine its most likely category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Respond with a single, valid JSON array of objects, where each object has a "name" and a "category" key. For example: [{"name": "apple", "category": "Produce"}, {"name": "ground beef", "category": "Meat & Seafood"}].`;
        
        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64ImageData } }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${await auth.getAccessToken()}`, 'Content-Type': 'application/json' },
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
        throw new HttpsError('internal', `AI processing failed due to an internal error: ${error.message}`);
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
    
    const { pantryItems, mealType, cuisine, criteria, unitSystem, timezone, cookingEquipment, prioritizedEquipment, existingTitles } = request.data;
    const usageCheck = await checkAndIncrementUsage(householdId, 'recipeGeneration', timezone);
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your AI recipe suggestions for the day.`);
    }

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;
        
        let prompt = `You are a helpful chef. Given the following list of pantry ingredients, suggest about 5 ${mealType} recipes.`;
        if (cuisine) prompt += ` The user prefers ${cuisine} cuisine.`;

        if (cookingEquipment && cookingEquipment.length > 0) {
            prompt += ` The user has access to this equipment: ${cookingEquipment.join(', ')}. The recipe instructions should be compatible with these tools where appropriate.`;
        }
        if (prioritizedEquipment) {
            prompt += ` The user would prefer a recipe that uses their ${prioritizedEquipment}. The cooking instructions should be written specifically for a ${prioritizedEquipment}.`;
        }
        if (existingTitles && existingTitles.length > 0) {
            prompt += ` CRITICAL: The user has already been suggested the following recipes: ${existingTitles.join(', ')}. Do not suggest these exact recipes or simple variations again. Provide completely new ideas.`;
        }
        
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

        prompt += ` Include a mix of 3 simple recipes and 3 more complex recipes. For each recipe, provide a title, a brief description, a serving size (e.g., "4 servings"), a list of ingredients, a single, simple keyword for an image search query, a step-by-step list of cooking instructions, and an estimated nutritional information object containing calories, protein, carbs, and fat as strings (e.g., "450 kcal", "30g"). For each ingredient, provide its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. CRITICAL: The recipe 'title' MUST NOT contain the name of any cooking equipment. The instructions should be tailored to the equipment, but the title must be a standard recipe name. Format your entire response as a single, valid JSON array of objects. Each recipe object should have "title", "description", "servingSize", "ingredients", "imageQuery", "instructions", and "nutrition" as keys. The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys. Pantry ingredients: ${pantryItems.join(", ")}`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };
        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${await auth.getAccessToken()}`, 'Content-Type': 'application/json' },
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
        throw new HttpsError('internal', `AI recipe generation failed: ${error.message}`);
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

    const { mealType, cuisine, criteria, unitSystem, timezone, cookingEquipment, prioritizedEquipment, existingTitles } = request.data;
    const usageCheck = await checkAndIncrementUsage(householdId, 'recipeGeneration', timezone);
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your AI recipe suggestions for the day.`);
    }

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        let prompt = `You are a helpful chef. Suggest 6 popular and delicious ${mealType} recipes.`;
        if (cuisine) prompt += ` The user prefers ${cuisine} cuisine.`;
        
        if (cookingEquipment && cookingEquipment.length > 0) {
            prompt += ` The user has access to this equipment: ${cookingEquipment.join(', ')}. The recipe instructions should be compatible with these tools where appropriate.`;
        }
        if (prioritizedEquipment) {
            prompt += ` The user would prefer a recipe that uses their ${prioritizedEquipment}. The cooking instructions should be written specifically for a ${prioritizedEquipment}.`;
        }
        if (existingTitles && existingTitles.length > 0) {
            prompt += ` CRITICAL: The user has already been suggested the following recipes: ${existingTitles.join(', ')}. Do not suggest these exact recipes or simple variations again. Provide completely new ideas.`;
        }

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
        prompt += ` Include a mix of simple and more complex options. For each recipe, provide a title, a brief description, a serving size (e.g., "4 servings"), a list of ingredients, a single, simple keyword for an image search query, a step-by-step list of cooking instructions, and an estimated nutritional information object containing calories, protein, carbs, and fat as strings (e.g., "450 kcal", "30g"). For each ingredient, provide its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. CRITICAL: The recipe 'title' MUST NOT contain the name of any cooking equipment. The instructions should be tailored to the equipment, but the title must be a standard recipe name. Format your entire response as a single, valid JSON array of objects. Each recipe object should have "title", "description", "servingSize", "ingredients", "imageQuery", "instructions", and "nutrition" as keys. The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys.`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };
        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${await auth.getAccessToken()}`, 'Content-Type': 'application/json' },
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
        throw new HttpsError('internal', `AI recipe discovery failed: ${error.message}`);
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
    
    const { mealQuery, unitSystem, timezone, cookingEquipment, prioritizedEquipment } = request.data;
    const usageCheck = await checkAndIncrementUsage(householdId, 'recipeGeneration', timezone);
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your AI recipe suggestions for the day.`);
    }

    if (!mealQuery) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "mealQuery".');
    }

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        let prompt = `You are an expert chef. A user wants a recipe for "${mealQuery}". Provide a single, detailed recipe for this meal.`;

        if (cookingEquipment && cookingEquipment.length > 0) {
            prompt += ` The user has access to this equipment: ${cookingEquipment.join(', ')}. The recipe instructions should be compatible with these tools where appropriate.`;
        }
        if (prioritizedEquipment) {
            prompt += ` The user would prefer a recipe that uses their ${prioritizedEquipment}. The cooking instructions should be written specifically for a ${prioritizedEquipment}.`;
        }

        prompt += `
        For the recipe, provide a title, a brief description, a serving size (e.g., "4 servings"), a list of all necessary ingredients, a simple image search keyword, step-by-step cooking instructions, and an estimated nutritional information object containing calories, protein, carbs, and fat as strings (e.g., "450 kcal", "30g").
        For each ingredient, provide its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"].
        CRITICAL: The recipe 'title' MUST NOT contain the name of any cooking equipment. The instructions should be tailored to the equipment, but the title must be a standard recipe name.
        Format your entire response as a single, valid JSON object with "title", "description", "servingSize", "ingredients", "imageQuery", "instructions", and "nutrition" as keys.
        The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys.`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${await auth.getAccessToken()}`, 'Content-Type': 'application/json' },
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
        throw new HttpsError('internal', `AI recipe generation failed for the specified query: ${error.message}`);
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
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;
        
        const prompt = `From the following HTML content, extract the recipe. Provide a title, a brief description, a serving size (e.g., "4 servings"), all ingredients, step-by-step cooking instructions, a simple image search keyword, and estimated nutritional information (calories, protein, carbs, fat). For each ingredient, extract its name, quantity, unit (in the ${unitSystem || 'imperial'} system), and categorize it from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Your entire response MUST be ONLY the resulting valid JSON object, starting with { and ending with }, without any surrounding text, comments, or markdown code fences like \`\`\`json. The JSON object must contain these exact keys: "title", "description", "servingSize", "ingredients", "imageQuery", "instructions", and "nutrition". The "ingredients" value must be an array of objects. HTML content: ${htmlContent}`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${await auth.getAccessToken()}`, 'Content-Type': 'application/json' },
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
        throw new HttpsError('internal', `AI recipe import failed: ${error.message}`);
    }
});


// --- HELPER: Excluded grocery items ---
const EXCLUDED_ITEMS = new Set([
    "water", "salt", "pepper", "black pepper", "salt and pepper", "cooking spray"
]);

// --- HELPER: Normalize ingredient names ---
// Cleans and standardizes ingredient names for better aggregation.
const normalizeIngredientName = (name) => {
    if (!name) return "";
    let normalized = name.toLowerCase().trim();

    // Remove common preparation instructions
    normalized = normalized.replace(/^(optional|sliced|chopped|diced|minced|crushed|whole|large|small|medium|fresh|to taste|for garnish)\s+/g, '');
    normalized = normalized.replace(/,.*$/, ''); // Remove anything after a comma

    // Handle plurals simply (e.g., "tomatoes" -> "tomato")
    if (normalized.endsWith('oes')) {
        normalized = normalized.slice(0, -2);
    } else if (normalized.endsWith('s')) {
        normalized = normalized.slice(0, -1);
    }

    // Common ingredient synonyms/grouping
    const mappings = {
        'avocado': 'avocado',
        'onion': 'onion',
        'garlic clove': 'garlic',
        'clove of garlic': 'garlic',
        'scallion': 'green onion',
        'green onion': 'green onion',
        'bell pepper': 'bell pepper',
        'chili pepper': 'chili pepper'
    };

    for (const key in mappings) {
        if (normalized.includes(key)) {
            return mappings[key];
        }
    }

    return normalized.trim();
};

// --- HELPER: Aggregate ingredient quantities (UPDATED) ---
// Combines quantities, adding them if units match, otherwise listing them.
const aggregateQuantities = (q1, q2) => {
    if (q1 === undefined || q1 === null || String(q1).trim() === "") return q2;
    if (q2 === undefined || q2 === null || String(q2).trim() === "") return q1;

    const q1Str = String(q1).trim();
    const q2Str = String(q2).trim();

    // Regex to separate numeric part from unit part
    const regex = /^([0-9./\s-]+)?\s*(.*)$/;

    const match1 = q1Str.match(regex);
    const match2 = q2Str.match(regex);

    let num1 = 0;
    const unit1 = (match1 && match1[2]) ? match1[2].trim().toLowerCase().replace(/s$/, '') : '';
    if (match1 && match1[1]) {
        try {
            const parts = match1[1].trim().split(/\s+/);
            num1 = parts.reduce((acc, part) => {
                if (part.includes('/')) {
                    const [top, bottom] = part.split('/');
                    return acc + (parseInt(top, 10) / parseInt(bottom, 10));
                }
                return acc + parseFloat(part);
            }, 0);
        } catch (e) { /* ignore parse error */ }
    }

    let num2 = 0;
    const unit2 = (match2 && match2[2]) ? match2[2].trim().toLowerCase().replace(/s$/, '') : '';
    if (match2 && match2[1]) {
        try {
            const parts = match2[1].trim().split(/\s+/);
            num2 = parts.reduce((acc, part) => {
                if (part.includes('/')) {
                    const [top, bottom] = part.split('/');
                    return acc + (parseInt(top, 10) / parseInt(bottom, 10));
                }
                return acc + parseFloat(part);
            }, 0);
        } catch (e) { /* ignore parse error */ }
    }

    // If units match and both are numeric, add them
    if (num1 > 0 && num2 > 0 && unit1 === unit2) {
        const total = num1 + num2;
        // Special handling for 'item' unit to avoid decimals and handle plurals
        if (unit1 === 'item') {
            const roundedTotal = Math.round(total);
            return `${roundedTotal} item${roundedTotal > 1 ? 's' : ''}`;
        }
        // Basic formatting, could be improved for complex fractions
        return `${Number(total.toFixed(2))} ${unit1}`;
    }

    // For non-numeric quantities (e.g., "a pinch") or different units
    if (q1Str === q2Str) return q1Str; // Avoid "1 pinch + 1 pinch"
    return `${q1Str} & ${q2Str}`;
};


// --- CLOUD FUNCTION (V2): generateGroceryList (UPDATED) ---
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
                            let name, quantity, category;

                            // Handle both new object format and legacy string format
                            if (typeof ing === 'object' && ing.name) {
                                name = ing.name;
                                quantity = `${ing.quantity || ''} ${ing.unit || ''}`.trim();
                                category = ing.category || 'Other';
                            } else if (typeof ing === 'string') {
                                name = ing;
                                quantity = "1 item"; // Default quantity for legacy items
                                category = 'Other';
                            } else {
                                return; // Skip unrecognized format
                            }

                            const normalizedName = normalizeIngredientName(name);
                            if (!normalizedName || EXCLUDED_ITEMS.has(normalizedName)) {
                                return; // Skip excluded or empty items
                            }
                            
                            // If quantity is empty (e.g. from an object with no quantity/unit), default it
                            if (quantity === "") {
                                quantity = "1 item";
                            }

                            if (neededIngredients.has(normalizedName)) {
                                const existing = neededIngredients.get(normalizedName);
                                existing.quantity = aggregateQuantities(existing.quantity, quantity);
                            } else {
                                neededIngredients.set(normalizedName, {
                                    name: normalizedName,
                                    quantity: quantity,
                                    category: category,
                                });
                            }
                        });
                    }
                }
            }
        }

        const pantrySnapshot = await db.collection('households').doc(householdId).collection('pantryItems').get();
        // Normalize pantry item names for accurate comparison
        const pantryItems = new Set(pantrySnapshot.docs.map(doc => normalizeIngredientName(doc.data().name)));

        const groceryListRef = db.collection('households').doc(householdId).collection('groceryListItems');
        const groceryListSnapshot = await groceryListRef.get();
        // Normalize existing grocery list item names
        const existingGroceryItems = new Set(groceryListSnapshot.docs.map(doc => normalizeIngredientName(doc.data().name)));

        const batch = db.batch();
        let itemsAdded = 0;

        neededIngredients.forEach((ingredient, name) => {
            // Check against normalized pantry and grocery lists
            if (!pantryItems.has(name) && !existingGroceryItems.has(name)) {
                const newItemRef = groceryListRef.doc();
                batch.set(newItemRef, {
                    name: ingredient.name,
                    category: ingredient.category,
                    quantity: ingredient.quantity, // Add the aggregated quantity
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
        throw new HttpsError('internal', `Failed to generate grocery list: ${error.message}`);
    }
});

// --- CLOUD FUNCTION (V2): planSingleDay ---
exports.planSingleDay = onCall({ timeoutSeconds: 540, region: "us-central1", enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }

    const { day, criteria, pantryItems, existingMeals, unitSystem, cookingEquipment } = request.data;
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

        if (cookingEquipment && cookingEquipment.length > 0) {
            prompt += ` The user has access to this equipment: ${cookingEquipment.join(', ')}. The recipe instructions should be compatible with these tools where appropriate.`;
        }

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

        prompt += ` For each recipe, provide a full recipe object. Each recipe object must have the following keys: "title", "description", "ingredients", "servingSize", "imageQuery", "instructions", and "nutrition".
        - The "ingredients" value must be an array of objects, with each object having "name", "quantity", "unit" (in the ${unitSystem || 'imperial'} system), and "category" keys.
        - The "servingSize" value should be a string like "4 servings".
        - The "imageQuery" value should be a simple keyword for an image search.
        - The "instructions" value must be an array of strings.
        - The "nutrition" value must be an object with "calories", "protein", "carbs", and "fat" as string values (e.g., "450 kcal", "30g").
        - CRITICAL: The recipe 'title' MUST NOT contain the name of any cooking equipment. The instructions should be tailored to the equipment, but the title must be a standard recipe name.
        
        VERY IMPORTANT: Structure your entire response as a single, valid JSON object. The top-level keys should be the meal types you planned (e.g., "breakfast", "dinner").
        Each meal's value should be an object where the key is a unique meal ID (e.g., "meal_1700000000") and the value is the full recipe object described above.`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${await auth.getAccessToken()}`, 'Content-Type': 'application/json' },
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
        throw new HttpsError('internal', `An unexpected error occurred while planning ${day}: ${error.message}`);
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

    const { image, timezone } = request.data;
    const usageCheck = await checkAndIncrementUsage(householdId, 'scan', timezone);
    if (!usageCheck.allowed) {
        throw new HttpsError('resource-exhausted', `You have used all ${usageCheck.limit} of your free scans for the day.`);
    }

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
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;

        const prompt = `Given this list of grocery items from a receipt, categorize each item into one of the following: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Also, clean up the item names to be generic (e.g., "ORG BANANAS" becomes "bananas"). Respond with a single, valid JSON array of objects, where each object has a "name" and a "category" key. Item list: ${itemNames.join(', ')}`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${await auth.getAccessToken()}`, 'Content-Type': 'application/json' },
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
        throw new HttpsError('internal', `Failed to process receipt: ${error.message}`);
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
                const mealTimes = { breakfast: { hour: 6, minute: 30 }, lunch: { hour: 12, minute: 0 }, dinner: { hour: 19, minute: 0 } };

                for (const day in plan) {
                    const dayOffset = dayIndexMap[day];
                    if (dayOffset === undefined) continue;

                    const eventDate = new Date(weekStartDate);
                    eventDate.setDate(eventDate.getDate() + dayOffset);

                    for (const meal in plan[day]) {
                        const mealTime = mealTimes[meal];
                        if (mealTime === undefined) continue;

                        for (const recipeId in plan[day][meal]) {
                            const recipe = plan[day][meal][recipeId];
                            const event = {
                                title: `${meal.charAt(0).toUpperCase() + meal.slice(1)}: ${recipe.title}`,
                                start: [eventDate.getFullYear(), eventDate.getMonth() + 1, eventDate.getDate(), mealTime.hour, mealTime.minute],
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

    const key = stripeSecretKey.value();
    if (!key) {
        throw new HttpsError('failed-precondition', 'The STRIPE_SECRET_KEY is not set in the Firebase environment. Please configure this secret to enable payments.');
    }
    const stripe = stripePackage(key);

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
            success_url: `https://automchef.com/app?payment_success=true`,
            cancel_url: `https://automchef.com/app?payment_cancel=true`,
            subscription_data: {
                metadata: {
                    householdId: householdId
                }
            },
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
    const key = stripeSecretKey.value();
    if (!key) {
        console.error("Stripe secret key is not configured.");
        return res.status(500).send("Stripe secret key is not configured.");
    }
    const stripe = stripePackage(key);
    
    const secret = stripeWebhookSecret.value();
    if(!secret) {
        console.error("Stripe webhook secret is not configured.");
        return res.status(500).send("Stripe webhook secret is not configured.");
    }
    const endpointSecret = secret;

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], endpointSecret);
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

    // Admin check: Only allow users with 'isAdmin' flag to run this.
    const adminUserDoc = await db.collection('users').doc(request.auth.uid).get();
    if (!adminUserDoc.exists || !adminUserDoc.data().isAdmin) {
        throw new HttpsError('permission-denied', 'You must be an admin to perform this action.');
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

        // FIX: Use set with merge:true instead of update for better reliability.
        await householdRef.set({
            subscriptionTier: 'paid',
            premiumAccessUntil: admin.firestore.Timestamp.fromDate(trialEndDate)
        }, { merge: true });

        return { success: true, message: `Trial granted to ${householdIdToGrant} until ${trialEndDate.toLocaleDateString()}.` };

    } catch (error) {
        console.error("Error in grantTrialAccess function:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'An error occurred while granting trial access.');
    }
});


// --- NEW CLOUD FUNCTION (V2): setAdminStatus ---
// This function allows a designated owner to make other users admins.
const OWNER_UID = "tjGRwEiWQzf9EKM09lgRxVNQSfj2";

exports.setAdminStatus = onCall({ enforceAppCheck: true }, async (request) => {
    // Only the designated owner can call this function.
    if (request.auth.uid !== OWNER_UID) {
        throw new HttpsError('permission-denied', 'Only the app owner can set admin status.');
    }

    const { targetUid, isAdmin } = request.data;
    if (!targetUid || typeof isAdmin !== 'boolean') {
        throw new HttpsError('invalid-argument', 'Please provide a "targetUid" and an "isAdmin" boolean value.');
    }

    try {
        const userRef = db.collection('users').doc(targetUid);
        await userRef.set({ isAdmin: isAdmin }, { merge: true });
        return { success: true, message: `User ${targetUid} admin status set to ${isAdmin}.` };
    } catch (error) {
        console.error("Error setting admin status:", error);
        throw new HttpsError('internal', 'An error occurred while setting admin status.');
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
exports.getCommunityRecipes = onCall({ region: "us-central1", enforceAppCheck: false }, async (request) => {
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
        throw new HttpsError('internal', `Could not fetch community recipes: ${error.message}`);
    }
});


// --- NEW BLOG/SEO FUNCTIONS ---

// NEW HELPER: Get a random recipe theme to make blog posts more dynamic
const getRecipeTheme = () => {
    const themes = [
        "a quick and easy 30-minute weeknight dinner",
        "a healthy and light lunch salad",
        "a decadent dessert for a special occasion",
        "a comforting soup for a cold day",
        "a unique vegetarian main course",
        "a seasonal dish perfect for the current time of year",
        "an international street food classic made at home",
        "a creative breakfast or brunch idea",
        "a budget-friendly family meal",
        "a sophisticated appetizer for a party",
        "a one-pot or one-pan meal for easy cleanup",
        "a classic comfort food with a modern twist"
    ];
    return themes[Math.floor(Math.random() * themes.length)];
};

// This is the scheduled function that will run automatically every day at 5 AM (server time).
exports.generateDailyRecipe = onSchedule('every day 05:00', async (event) => {
    console.log("Running daily recipe generation job.");
    const recipeTheme = getRecipeTheme();
    console.log(`Generating daily recipe with theme: "${recipeTheme}"`);

    const prompt = `You are a creative chef. Generate a single, complete, and unique recipe based on the following theme: "${recipeTheme}". 
        The recipe should have a creative and SEO-friendly title.
        Provide a brief, engaging description (2-3 sentences).
        Include a serving size, a detailed list of ingredients (with name, quantity, unit, and category), step-by-step instructions, and estimated nutritional information (calories, protein, carbs, fat).
        Finally, provide a simple, descriptive keyword phrase for an image search (e.g., "rustic chicken noodle soup").
        Format your entire response as a single, valid JSON object with keys: "title", "slug", "description", "servingSize", "ingredients", "instructions", "nutrition", and "imageQuery". 
        The "slug" should be a URL-friendly version of the title (e.g., "rustic-chicken-noodle-soup").`;

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;
        
        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${await auth.getAccessToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aiRequest),
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new Error(`AI API request failed: ${errorText}`);
        }
        
        const responseData = await aiResponse.json();
        const jsonTextResponse = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!jsonTextResponse) {
             throw new Error('Failed to get a valid response from the AI service.');
        }

        const recipe = JSON.parse(jsonTextResponse);
        recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);

        const publicRecipesRef = db.collection('publicRecipes');
        await publicRecipesRef.add({
            ...recipe,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Successfully generated and saved recipe: "${recipe.title}"`);
        return null;

    } catch (error) {
        console.error("Error in generateDailyRecipe scheduled function:", error);
        return null;
    }
});

// This function allows the public-facing blog pages to securely fetch recipe data.
exports.getPublicRecipes = onCall({ region: "us-central1", enforceAppCheck: false }, async (request) => {
    try {
        const { slug, limit } = request.data || {};
        const recipesRef = db.collection('publicRecipes');

        if (slug) {
            const snapshot = await recipesRef.where('slug', '==', slug).limit(1).get();
            if (snapshot.empty) {
                throw new HttpsError('not-found', 'No recipe found with that slug.');
            }
            const recipe = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
            return { recipe };
        } else {
            const snapshot = await recipesRef.get();
            let recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            recipes.sort((a, b) => {
                const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
                const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
                return timeB - timeA;
            });

            if (limit) {
                recipes = recipes.slice(0, limit);
            }

            return { recipes };
        }
    } catch (error) {
        console.error("Error fetching public recipes:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Could not fetch recipes.');
    }
});



// This function allows an admin to manually trigger recipe generation.
exports.generateRecipeForBlog = onCall({ enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const adminUserDoc = await db.collection('users').doc(request.auth.uid).get();
    if (!adminUserDoc.exists || !adminUserDoc.data().isAdmin) {
        throw new HttpsError('permission-denied', 'You must be an admin to perform this action.');
    }
    
    const recipeTheme = getRecipeTheme();
    console.log(`Manually generating blog recipe with theme: "${recipeTheme}"`);

    // Re-using the same logic from the scheduled function.
    const prompt = `You are a creative chef. Generate a single, complete, and unique recipe based on the following theme: "${recipeTheme}". 
        The recipe should have a creative and SEO-friendly title.
        Provide a brief, engaging description (2-3 sentences).
        Include a serving size, a detailed list of ingredients (with name, quantity, unit, and category), step-by-step instructions, and estimated nutritional information (calories, protein, carbs, fat).
        Finally, provide a simple, descriptive keyword phrase for an image search (e.g., "rustic chicken noodle soup").
        Format your entire response as a single, valid JSON object with keys: "title", "slug", "description", "servingSize", "ingredients", "instructions", "nutrition", and "imageQuery". 
        The "slug" should be a URL-friendly version of the title (e.g., "rustic-chicken-noodle-soup").`;

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${GEMINI_MODEL_NAME}:generateContent`;
        
        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { "responseMimeType": "application/json" }
        };

        const aiResponse = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${await auth.getAccessToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aiRequest),
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new HttpsError('internal', `AI API request failed: ${errorText}`);
        }
        
        const responseData = await aiResponse.json();
        const jsonTextResponse = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!jsonTextResponse) {
             throw new HttpsError('internal', 'Failed to get a valid response from the AI service.');
        }

        const recipe = JSON.parse(jsonTextResponse);
        recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);

        const publicRecipesRef = db.collection('publicRecipes');
        await publicRecipesRef.add({
            ...recipe,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return { success: true, message: `Successfully generated and saved recipe: "${recipe.title}"` };

    } catch (error) {
        console.error("Error in generateRecipeForBlog:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', `Failed to generate daily recipe: ${error.message}`);
    }
});

// --- UPDATED FUNCTION: Get an alternate image with source preference ---
exports.getAlternateImage = onCall({ region: "us-central1", enforceAppCheck: true }, async (request) => {
    const { query, sourcePreference } = request.data;
    if (!query) {
        throw new HttpsError('invalid-argument', 'A query must be provided.');
    }

    let imageUrl;
    if (sourcePreference === 'pexels') {
        imageUrl = await getPexelsImage(query);
    } else {
        // Default to Unsplash if no preference or other value is given
        imageUrl = await getUnsplashImage(query);
    }

    if (imageUrl) {
        return { imageUrl };
    } else {
        throw new HttpsError('not-found', `Could not find an image for that query from ${sourcePreference || 'Unsplash'}.`);
    }
});

// --- UPDATED FUNCTION: Update a recipe's image URL in Firestore for all cases ---
exports.updateRecipeImage = onCall({ enforceAppCheck: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }

    const { recipeId, newImageUrl, newImageSource, mealPlanDetails, suggestionDetails } = request.data;
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const householdId = userDoc.data()?.householdId;

    if (!householdId) {
        throw new HttpsError('failed-precondition', 'User is not part of a household.');
    }

    const updateData = {
        imageUrl: newImageUrl,
        imageSource: newImageSource // Save the source of the new image
    };

    try {
        // Scenario 1: Update a favorite recipe
        if (recipeId) {
            const favoriteRef = db.collection('households').doc(householdId).collection('favoriteRecipes').doc(recipeId);
            await favoriteRef.update(updateData);
            return { success: true, message: 'Favorite recipe image updated.' };
        }
        // Scenario 2: Update a recipe in a meal plan
        else if (mealPlanDetails) {
            const { weekId, day, meal, mealId } = mealPlanDetails;
            const mealPlanRef = db.collection('households').doc(householdId).collection('mealPlan').doc(weekId);
            const mealPlanDoc = await mealPlanRef.get();
            if (mealPlanDoc.exists()) {
                const planData = mealPlanDoc.data();
                // We need to update the specific nested object
                if (planData.meals?.[day]?.[meal]?.[mealId]) {
                    planData.meals[day][meal][mealId].imageUrl = newImageUrl;
                    planData.meals[day][meal][mealId].imageSource = newImageSource;
                    await mealPlanRef.set(planData);
                    return { success: true, message: 'Meal plan recipe image updated.' };
                }
            }
             throw new HttpsError('not-found', 'Could not find the meal plan item to update.');
        }
        // NEW Scenario 3: Update a recipe in the daily suggestions
        else if (suggestionDetails) {
            const { suggestionDate, recipeTitle } = suggestionDetails;
            const suggestionRef = db.collection('households').doc(householdId).collection('dailySuggestions').doc(suggestionDate);
            const suggestionDoc = await suggestionRef.get();

            if (suggestionDoc.exists) {
                const data = suggestionDoc.data();
                let recipes = data.recipes || [];
                const recipeIndex = recipes.findIndex(r => r.title === recipeTitle);

                if (recipeIndex > -1) {
                    recipes[recipeIndex].imageUrl = newImageUrl;
                    recipes[recipeIndex].imageSource = newImageSource;
                    await suggestionRef.update({ recipes: recipes });
                    return { success: true, message: 'Suggested recipe image updated.' };
                } else {
                     throw new HttpsError('not-found', 'Could not find the suggested recipe to update.');
                }
            } else {
                 throw new HttpsError('not-found', 'Could not find the daily suggestion list to update.');
            }
        }
        else {
            throw new HttpsError('invalid-argument', 'You must provide recipeId, mealPlanDetails, or suggestionDetails.');
        }
    } catch (error) {
        console.error("Error updating recipe image:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Could not update the recipe image in the database.');
    }
});
