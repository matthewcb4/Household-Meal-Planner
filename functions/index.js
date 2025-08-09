// index.js (Cloud Functions)

const functions = require("firebase-functions");
const { GoogleAuth } = require("google-auth-library");
const admin = require("firebase-admin");
admin.initializeApp();

// Corrected identifyItems function
exports.identifyItems = functions.https.onCall(async (data, context) => {
    // data.image already contains the base64 string
    const base64ImageData = data.image;
    
    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-pro-vision:generateContent`;

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
            throw new functions.https.HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }
        const responseData = await aiResponse.json();
        const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
        return JSON.parse(jsonTextResponse); // Return the data directly
    } catch (error) {
        console.error("Internal Function Error:", error);
        throw new functions.https.HttpsError('internal', "AI processing failed due to an internal error.");
    }
});

// Corrected suggestRecipes function
exports.suggestRecipes = functions.https.onCall(async (data, context) => {
    const { pantryItems, mealType } = data;

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-pro:generateContent`;

        const prompt = `You are a helpful chef. Given the following list of pantry ingredients, suggest about 5 recipes consisting of 2-3 simple recipes, and 2-3 more complex recipes. ${mealType} recipes. For each recipe, provide a title, a brief description, and a list of the ingredients used from the pantry. Format your entire response as a single, valid JSON array of objects, where each object has "title", "description", and "ingredients" (an array of strings) as keys. Pantry ingredients: ${pantryItems.join(", ")}`;

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
            throw new functions.https.HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }
        const responseData = await aiResponse.json();
        const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
        return JSON.parse(jsonTextResponse);
    } catch (error) {
        console.error("Internal Recipe Function Error:", error);
        throw new functions.https.HttpsError('internal', "AI recipe generation failed.");
    }
});

// Corrected discoverRecipes function
exports.discoverRecipes = functions.https.onCall(async (data, context) => {
    const { mealType } = data;

    try {
        const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
        const authToken = await auth.getAccessToken();
        const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-pro:generateContent`;

        const prompt = `You are a helpful chef. Suggest 5 popular and delicious ${mealType} recipes. Include a mix of simple and more complex options. For each recipe, provide a title, a brief description, and a list of ingredients. For each ingredient, provide its name, quantity, unit, and its category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Format your entire response as a single, valid JSON array of objects. Each recipe object should have "title", "description", and "ingredients" as keys. The "ingredients" key should be an array of objects, where each ingredient object has "name", "quantity", "unit", and "category" keys.`;

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
            throw new functions.https.HttpsError('internal', `AI API request failed with status ${aiResponse.status}`);
        }
        const responseData = await aiResponse.json();
        const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
        return JSON.parse(jsonTextResponse);
    } catch (error) {
        console.error("Internal Discover Function Error:", error);
        throw new functions.https.HttpsError('internal', "AI recipe discovery failed.");
    }
});