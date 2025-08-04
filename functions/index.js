const functions = require("firebase-functions/v1");
const { GoogleAuth } = require("google-auth-library");
const cors = require("cors")({ origin: true });
const admin = require("firebase-admin");
admin.initializeApp();

// identifyItems function is unchanged
exports.identifyItems = functions.https.onRequest((request, response) => {
    cors(request, response, async () => {
        if (request.method !== "POST") { return response.status(405).send("Method Not Allowed"); }
        try {
            const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
            const authToken = await auth.getAccessToken();
            const base64ImageData = request.body.data.image;
            const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
            const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent`;

            const prompt = `Identify all distinct food items in this image. For each item, determine its most likely category from this list: ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"]. Respond with a single, valid JSON array of objects, where each object has a "name" and a "category" key. For example: [{"name": "apple", "category": "Produce"}, {"name": "ground beef", "category": "Meat & Seafood"}].`;
            const aiRequest = {
                contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64ImageData } }] }],
                "generation_config": { "response_mime_type": "application/json" }
            };
            const aiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(aiRequest),
            });

            if (!aiResponse.ok) {
                const errorText = await aiResponse.text();
                console.error("AI API Error Response:", errorText);
                throw new Error(`AI API request failed with status ${aiResponse.status}`);
            }
            const responseData = await aiResponse.json();
            const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            return response.status(200).send({ data: JSON.parse(jsonTextResponse) });
        } catch (error) {
            console.error("Internal Function Error:", error);
            return response.status(500).send({ error: "AI processing failed due to an internal error." });
        }
    });
});

// UPDATED suggestRecipes function
exports.suggestRecipes = functions.https.onRequest((request, response) => {
    cors(request, response, async () => {
        if (request.method !== "POST") { return response.status(405).send("Method Not Allowed"); }
        try {
            const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
            const authToken = await auth.getAccessToken();
            // Get both pantryItems AND the new mealType from the request
            const { pantryItems, mealType } = request.body.data;
            const projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
            const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent`;

            // The prompt is now dynamic based on the selected meal type
            const prompt = `You are a helpful chef. Given the following list of pantry ingredients,  suggest about 5 recipes consisting of 2-3 simple recipes, and 2-3 more complex recipes. ${mealType} recipes. For each recipe, provide a title, a brief description, and a list of the ingredients used from the pantry. Format your entire response as a single, valid JSON array of objects, where each object has "title", "description", and "ingredients" (an array of strings) as keys. Pantry ingredients: ${pantryItems.join(", ")}`;

            const aiRequest = {
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                "generation_config": { "response_mime_type": "application/json" }
            };
            const aiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(aiRequest),
            });

            if (!aiResponse.ok) {
                const errorText = await aiResponse.text();
                console.error("AI Recipe API Error Response:", errorText);
                throw new Error(`AI API request failed with status ${aiResponse.status}`);
            }
            const responseData = await aiResponse.json();
            const jsonTextResponse = responseData.candidates[0].content.parts[0].text;
            return response.status(200).send({ data: JSON.parse(jsonTextResponse) });
        } catch (error) {
            console.error("Internal Recipe Function Error:", error);
            return response.status(500).send({ error: "AI recipe generation failed." });
        }
    });
});