// public/blog.js

// Import necessary Firebase functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Your web app's Firebase configuration (copied from your main script)
const firebaseConfig = {
  apiKey: "AIzaSyDcsZlszhp5v93YheCfjkOYdzwf7ZQ_nm8",
  authDomain: "family-dinner-app-79249.firebaseapp.com",
  projectId: "family-dinner-app-79249",
  storageBucket: "family-dinner-app-79249.firebasestorage.app",
  messagingSenderId: "665272276696",
  appId: "1:665272276696:web:f5aa5a5888f8abf97e69ad",
  measurementId: "G-LQ124BNWKH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

/**
 * Creates an HTML card for a single recipe on the blog listing page.
 * @param {object} recipe - The recipe data object from Firestore.
 * @returns {string} - The HTML string for the recipe card.
 */
function createBlogRecipeCard(recipe) {
    if (!recipe) return '';

    // Use a placeholder if the image URL is missing
    const imageUrl = recipe.imageUrl || `https://placehold.co/600x400/282828/FFF?text=${encodeURIComponent(recipe.title)}`;
    const recipeUrl = `/recipe?slug=${recipe.slug}`;

    return `
        <a href="${recipeUrl}" class="feature-card" style="text-align: left; text-decoration: none; color: inherit;">
            <img src="${imageUrl}" alt="${recipe.title}" style="width: 100%; height: 200px; object-fit: cover; border-radius: var(--border-radius); margin-bottom: 1rem;">
            <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem;">${recipe.title}</h3>
            <p style="color: var(--text-secondary-color);">${recipe.description}</p>
        </a>
    `;
}

/**
 * Populates the individual recipe page with data.
 * @param {object} recipe - The recipe data object.
 */
function populateRecipePage(recipe) {
    // Set SEO and page metadata
    document.title = `${recipe.title} | Auto Meal Chef`;
    document.querySelector('meta[name="description"]').setAttribute('content', recipe.description);

    // Populate the page content
    const container = document.getElementById('recipe-content-container');
    if (!container) return;
    
    const imageUrl = recipe.imageUrl || `https://placehold.co/800x400/282828/FFF?text=${encodeURIComponent(recipe.title)}`;
    const ingredientsList = recipe.ingredients.map(ing => `<li>${ing.quantity} ${ing.unit} ${ing.name}</li>`).join('');
    const instructionsList = recipe.instructions.map(step => `<li>${step}</li>`).join('');

    container.innerHTML = `
        <div class="recipe-header">
            <img src="${imageUrl}" alt="${recipe.title}">
            <h1>${recipe.title}</h1>
            <p>${recipe.description}</p>
        </div>

        <div class="recipe-details">
            <div class="detail-item">
                <strong>Servings</strong>
                <span>${recipe.servingSize || 'N/A'}</span>
            </div>
            <div class="detail-item">
                <strong>Calories</strong>
                <span>${recipe.nutrition.calories || 'N/A'}</span>
            </div>
            <div class="detail-item">
                <strong>Protein</strong>
                <span>${recipe.nutrition.protein || 'N/A'}</span>
            </div>
             <div class="detail-item">
                <strong>Carbs</strong>
                <span>${recipe.nutrition.carbs || 'N/A'}</span>
            </div>
        </div>

        <div class="recipe-body">
            <div class="recipe-ingredients">
                <h2>Ingredients</h2>
                <ul>${ingredientsList}</ul>
            </div>
            <div class="recipe-instructions">
                <h2>Instructions</h2>
                <ol>${instructionsList}</ol>
            </div>
        </div>
        
        <div class="cta-box">
            <h2>Like this recipe?</h2>
            <p>Get unlimited AI-powered meal plans and smart grocery lists with the Auto Meal Chef app.</p>
            <a href="/app.html" class="primary-btn large-btn">Start Planning for Free</a>
        </div>
    `;
}


/**
 * Main function that runs on page load.
 * Determines if we are on the blog list or a single recipe page and acts accordingly.
 */
document.addEventListener('DOMContentLoaded', async () => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    const getPublicRecipes = httpsCallable(functions, 'getPublicRecipes');

    // --- LOGIC FOR SINGLE RECIPE PAGE ---
    if (path.includes('/recipe') && params.has('slug')) {
        const slug = params.get('slug');
        const container = document.getElementById('recipe-content-container');
        try {
            const result = await getPublicRecipes({ slug });
            populateRecipePage(result.data.recipe);
        } catch (error) {
            console.error("Error fetching single recipe:", error);
            if(container) container.innerHTML = "<h1>Recipe not found</h1><p>Sorry, we couldn't find the recipe you were looking for.</p>";
        }
    } 
    // --- LOGIC FOR BLOG LISTING PAGE ---
    else if (path.includes('/blog.html')) {
        const gridContainer = document.getElementById('recipe-grid-container');
        try {
            const result = await getPublicRecipes({}); // Fetch latest recipes
            const recipes = result.data.recipes;
            if (recipes && recipes.length > 0) {
                gridContainer.innerHTML = recipes.map(createBlogRecipeCard).join('');
            } else {
                gridContainer.innerHTML = '<p>No recipes found yet. Our AI chef is busy cooking up the first one!</p>';
            }
        } catch (error) {
            console.error("Error fetching recipes for blog:", error);
            gridContainer.innerHTML = '<p>Could not load recipes at this time. Please try again later.</p>';
        }
    }
});
