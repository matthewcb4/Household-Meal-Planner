// public/content.js

// --- Import Firebase modules ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// --- Firebase configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyDcsZlszhp5v93YheCfjkOYdzwf7ZQ_nm8",
  authDomain: "family-dinner-app-79249.firebaseapp.com",
  projectId: "family-dinner-app-79249",
  storageBucket: "family-dinner-app-79249.firebasestorage.app",
  messagingSenderId: "665272276696",
  appId: "1:665272276696:web:f5aa5a5888f8abf97e69ad",
  measurementId: "G-LQ124BNWKH"
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

/**
 * Creates an HTML card for a single recipe.
 * @param {object} recipe - The recipe data object from Firestore.
 * @returns {string} - The HTML string for the recipe card.
 */
function createBlogRecipeCard(recipe) {
    if (!recipe) return '';

    const imageUrl = recipe.imageUrl || `https://placehold.co/600x400/282828/FFF?text=${encodeURIComponent(recipe.title)}`;
    const recipeUrl = `/recipe.html?slug=${recipe.slug}`;

    return `
        <a href="${recipeUrl}" class="feature-card" style="text-align: left; text-decoration: none; color: inherit;">
            <img src="${imageUrl}" alt="${recipe.title}" style="width: 100%; height: 200px; object-fit: cover; border-radius: var(--border-radius); margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem;">${recipe.title}</h3>
                <strong style="color: var(--primary-accent-color); font-size: 0.9rem; white-space: nowrap;">${recipe.mealType || ''}</strong>
            </div>
            <p style="color: var(--text-secondary-color);">${recipe.description}</p>
        </a>
    `;
}

/**
 * Populates the individual recipe page with data.
 * @param {object} recipe - The recipe data object.
 */
function populateRecipePage(recipe) {
    document.title = `${recipe.title} | Auto Meal Chef`;
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
        metaDescription.setAttribute('content', recipe.description);
    }

    const container = document.getElementById('recipe-content-container');
    if (!container) return;
    
    const imageUrl = recipe.imageUrl || `https://placehold.co/800x400/282828/FFF?text=${encodeURIComponent(recipe.title)}`;
    const ingredientsList = (recipe.ingredients || []).map(ing => `<li>${ing.quantity} ${ing.unit} ${ing.name}</li>`).join('');
    const instructionsList = (recipe.instructions || []).map(step => `<li>${step}</li>`).join('');
    const nutrition = recipe.nutrition || {};

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
                <span>${nutrition.calories || 'N/A'}</span>
            </div>
            <div class="detail-item">
                <strong>Protein</strong>
                <span>${nutrition.protein || 'N/A'}</span>
            </div>
             <div class="detail-item">
                <strong>Carbs</strong>
                <span>${nutrition.carbs || 'N/A'}</span>
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
 * Groups recipes by date and then by their daily theme title.
 * @param {Array<object>} recipes - The array of recipe objects.
 * @returns {Map<string, Map<string, Array<object>>>} - A nested map of recipes.
 */
function groupRecipesByDateAndTheme(recipes) {
    const grouped = new Map();

    recipes.forEach(recipe => {
        if (recipe.createdAt && recipe.createdAt._seconds) {
            const date = new Date(recipe.createdAt._seconds * 1000);
            const dateString = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const themeTitle = recipe.dailyTitle || 'Individual Recipes';

            if (!grouped.has(dateString)) {
                grouped.set(dateString, new Map());
            }
            const dateGroup = grouped.get(dateString);

            if (!dateGroup.has(themeTitle)) {
                dateGroup.set(themeTitle, []);
            }
            dateGroup.get(themeTitle).push(recipe);
        }
    });

    return grouped;
}

/**
 * Populates the timeline sidebar with a collapsible monthly archive.
 * @param {Map<string, any>} groupedRecipes - The grouped recipes map.
 */
function populateTimeline(groupedRecipes) {
    const timelineList = document.getElementById('timeline-list');
    if (!timelineList) return;

    // Group dates by month and year
    const monthlyArchive = new Map();
    for (const dateString of groupedRecipes.keys()) {
        try {
            const date = new Date(dateString);
            // Create a key like "October 2025"
            const monthYearKey = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });

            if (!monthlyArchive.has(monthYearKey)) {
                monthlyArchive.set(monthYearKey, []);
            }
            monthlyArchive.get(monthYearKey).push(dateString);
        } catch (e) {
            console.error(`Could not parse date: ${dateString}`, e);
        }
    }

    let timelineHtml = '';
    // Sort months chronologically, newest first
    const sortedMonths = Array.from(monthlyArchive.keys()).sort((a, b) => new Date(b) - new Date(a));

    for (const monthYearKey of sortedMonths) {
        const dateStrings = monthlyArchive.get(monthYearKey);
        // Sort days within the month, newest first
        const sortedDateStrings = dateStrings.sort((a,b) => new Date(b) - new Date(a));

        timelineHtml += `
            <li class="month-item">
                <div class="month-header">
                    <span class="month-name">${monthYearKey}</span>
                    <span class="toggle-icon">+</span>
                </div>
                <ul class="day-links-list" style="display: none;">
        `;

        for (const dateString of sortedDateStrings) {
            const linkId = dateString.toLowerCase().replace(/,/, '').replace(/\s+/g, '-');
            timelineHtml += `<li><a href="#date-${linkId}">${dateString}</a></li>`;
        }

        timelineHtml += `</ul></li>`;
    }

    timelineList.innerHTML = timelineHtml;
}


/**
 * Main function that runs on page load.
 */
document.addEventListener('DOMContentLoaded', async () => {
    // --- Particle Background Animation using Three.js ---
    const particleContainer = document.getElementById('particle-background');
    if (particleContainer && typeof THREE !== 'undefined') {
        let scene, camera, renderer, particles, material;
        let windowHalfX = window.innerWidth / 2;
        let windowHalfY = window.innerHeight / 2;
        let mouseX = 0;
        let mouseY = 0;

        function initParticles() {
            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 10000);
            camera.position.z = 1000;

            const particleCount = 1000;
            const particlesGeometry = new THREE.BufferGeometry();
            const positions = new Float32Array(particleCount * 3);

            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;
                positions[i3] = Math.random() * 2000 - 1000;
                positions[i3 + 1] = Math.random() * 2000 - 1000;
                positions[i3 + 2] = Math.random() * 2000 - 1000;
            }
            particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            material = new THREE.PointsMaterial({
                color: 0x1DB954,
                size: 2,
                transparent: true,
                opacity: 0.7,
                blending: THREE.AdditiveBlending
            });

            particles = new THREE.Points(particlesGeometry, material);
            scene.add(particles);

            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);
            particleContainer.appendChild(renderer.domElement);

            document.addEventListener('mousemove', onDocumentMouseMove, false);
            window.addEventListener('resize', onWindowResize, false);
        }

        function onWindowResize() {
            windowHalfX = window.innerWidth / 2;
            windowHalfY = window.innerHeight / 2;
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        function onDocumentMouseMove(event) {
            mouseX = (event.clientX - windowHalfX) / 2;
            mouseY = (event.clientY - windowHalfY) / 2;
        }

        function animateParticles() {
            requestAnimationFrame(animateParticles);
            renderParticles();
        }

        function renderParticles() {
            const time = Date.now() * 0.00005;
            camera.position.x += (mouseX - camera.position.x) * 0.05;
            camera.position.y += (-mouseY - camera.position.y) * 0.05;
            camera.lookAt(scene.position);

            particles.rotation.x = time * 0.2;
            particles.rotation.y = time * 0.4;

            renderer.render(scene, camera);
        }

        initParticles();
        animateParticles();
    }

    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    const getPublicRecipes = httpsCallable(functions, 'getPublicRecipes');

    // --- LOGIC FOR INDIVIDUAL RECIPE PAGE ---
    if ((path.includes('/recipe.html') || path === '/recipe') && params.has('slug')) {
        const slug = params.get('slug');
        const container = document.getElementById('recipe-content-container');
        try {
            const result = await getPublicRecipes({ slug });
            const recipe = result.data.recipe;
            if (recipe) {
                populateRecipePage(recipe);
            } else {
                 throw new Error("Recipe with that slug not found.");
            }
        } catch (error) {
            console.error("Error fetching single recipe:", error);
            if(container) container.innerHTML = "<h1>Recipe not found</h1><p>Sorry, we couldn't find the recipe you were looking for.</p>";
        }
    } 
    // --- LOGIC FOR BLOG LISTING PAGE ---
    else if (path.includes('/blog.html') || path === '/blog') {
        const gridContainer = document.getElementById('recipe-grid-container');
        const timelineList = document.getElementById('timeline-list');
        if (!gridContainer || !timelineList) return;

        // Add event listener for collapsible archive
        timelineList.addEventListener('click', (event) => {
            const header = event.target.closest('.month-header');
            if (header) {
                const list = header.nextElementSibling;
                const icon = header.querySelector('.toggle-icon');
                if (list && icon) {
                    const isVisible = list.style.display !== 'none';
                    list.style.display = isVisible ? 'none' : 'block';
                    icon.textContent = isVisible ? '+' : '−';
                }
            }
        });
        
        try {
            const result = await getPublicRecipes({}); 
            const recipes = result.data.recipes;
            if (recipes && recipes.length > 0) {
                const groupedRecipes = groupRecipesByDateAndTheme(recipes);
                populateTimeline(groupedRecipes);
                
                let finalHtml = '';
                for (const [dateString, themes] of groupedRecipes.entries()) {
                    const linkId = dateString.toLowerCase().replace(/,/, '').replace(/\s+/g, '-');
                    finalHtml += `<h2 id="date-${linkId}" class="blog-date-header">${dateString}</h2>`;
                    for (const [themeTitle, recipeGroup] of themes.entries()) {
                        finalHtml += `<h3 class="daily-theme-header">${themeTitle}</h3>`;
                        finalHtml += '<div class="features-grid">';
                        finalHtml += recipeGroup.map(createBlogRecipeCard).join('');
                        finalHtml += '</div>';
                    }
                }
                
                gridContainer.innerHTML = finalHtml;
            } else {
                gridContainer.innerHTML = '<p>No recipes found yet. Our AI chef is busy cooking up the first one!</p>';
            }
        } catch (error) {
            console.error("Error fetching recipes for blog:", error);
            gridContainer.innerHTML = '<p>Could not load recipes at this time. Please try again later.</p>';
        }
    }
    // --- LOGIC FOR HOMEPAGE ---
    else if (path === '/' || path.includes('/index.html')) {
        // --- Recipe of the Day Logic ---
        const dailyRecipeContainer = document.getElementById('daily-recipe-container');
        if (dailyRecipeContainer) {
            try {
                const result = await getPublicRecipes({ limit: 3 });
                const recipes = result.data.recipes;

                if (!recipes || recipes.length < 3) {
                    dailyRecipeContainer.innerHTML = '<p>No recipes of the day found. Our AI is cooking some up, check back tomorrow!</p>';
                    return;
                }

                const dailyTitle = recipes[0].dailyTitle || "Today's Top Recipes";
                
                let recipesHtml = `<h3 class="daily-theme-header" style="text-align: center; margin-bottom: 2rem;">${dailyTitle}</h3>`;
                recipesHtml += '<div class="features-grid">';
                recipesHtml += recipes.map(createBlogRecipeCard).join('');
                recipesHtml += '</div>';

                dailyRecipeContainer.innerHTML = recipesHtml;

            } catch (error) {
                console.error("Error fetching recipe of the day:", error);
                dailyRecipeContainer.innerHTML = '<p>Could not load today\'s recipes. Please try again later.</p>';
            }
        }
    }
});
