// index.js (Cloud Functions) - Updated for v2 and latest Gemini model

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const { GoogleAuth } = require("google-auth-library");
const admin = require("firebase-admin");
admin.initializeApp();

// Define the Pexels API key as a secret
const pexelsKey = defineString("PEXELS_KEY");

// --- Pexels Image Fetching Function ---
const getPexelsImage = async (query) => {
    try {
        const apiKey = pexelsKey.value();
        if (!apiKey) {
            console.error("Pexels API key is not set as a secret.");
            return null;
        }

        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`;
        const response = await fetch(url, {
            headers: {
                'Authorization': apiKey
            }
        });

        if (!response.ok) {
            console.error(`Pexels API error: ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        if (data.photos && data.photos.length > 0) {
            return data.photos[0].src.large;
        }
        return null;
    } catch (error) {
        console.error("Error fetching image from Pexels:", error);
        return null;
    }
};


// identifyItems function updated to use the latest Gemini model
exports.identifyItems = onCall(async (request) => {
    const base64ImageData = request.data.image;
    
    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent`;

        const prompt = `Identify all distinct food items in this image. For each item, determine its most likely category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Respond with a single, valid JSON array of objects, where each object has a "name" and a "category" key. For example: [{"name": "apple", "category": "Produce"}, {"name": "ground beef", "category": "Meat & Seafood"}].`;
        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64ImageData } }] }],
            generation_config: { "response_mime_type": "application/json" }
        };
        const aiResponse = await fetch(apiUrl, {
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
        const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
        return JSON.parse(jsonTextResponse);
    } catch (error) {
        console.error("Internal Function Error:", error);
        throw new HttpsError('internal', "AI processing failed due to an internal error.");
    }
});

// suggestRecipes function updated to use the latest Gemini model
exports.suggestRecipes = onCall(async (request) => {
    const { pantryItems, mealType } = request.data;

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent`;

        const prompt = `You are a helpful chef. Given the following list of pantry ingredients, suggest about 5 recipes consisting of 2-3 simple recipes, and 2-3 more complex recipes. ${mealType} recipes. For each recipe, provide a title, a brief description, a list of the ingredients used from the pantry, and a single, simple keyword for an image search query for the recipe. Format your entire response as a single, valid JSON array of objects, where each object has "title", "description", "ingredients" (an array of strings), and "imageQuery" (a string) as keys. Pantry ingredients: ${pantryItems.join(", ")}`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generation_config: { "response_mime_type": "application/json" }
        };
        const aiResponse = await fetch(apiUrl, {
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
        const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
        const recipes = JSON.parse(jsonTextResponse);

        for (const recipe of recipes) {
            recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);
        }

        return recipes;
    } catch (error) {
        console.error("Internal Recipe Function Error:", error);
        throw new HttpsError('internal', "AI recipe generation failed.");
    }
});

// discoverRecipes function updated to use the latest Gemini model
exports.discoverRecipes = onCall(async (request) => {
    const { mealType } = request.data;

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent`;

        const prompt = `You are a helpful chef. Suggest 5 popular and delicious ${mealType} recipes. Include a mix of simple and more complex options. For each recipe, provide a title, a brief description, a list of ingredients, and a single, simple keyword for an image search query for the recipe. For each ingredient, provide its name, quantity, unit, and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Format your entire response as a single, valid JSON array of objects. Each recipe object should have "title", "description", "ingredients", and "imageQuery" as keys. The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys.`;

        const aiRequest = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generation_config: { "response_mime_type": "application/json" }
        };
        const aiResponse = await fetch(apiUrl, {
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
        const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
        const recipes = JSON.parse(jsonTextResponse);

        for (const recipe of recipes) {
            recipe.imageUrl = await getPexelsImage(recipe.imageQuery || recipe.title);
        }

        return recipes;
    } catch (error) {
        console.error("Internal Discover Function Error:", error);
        throw new HttpsError('internal', "AI recipe discovery failed.");
    }
});