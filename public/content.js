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
 * Creates an HTML card for a single recipe on the blog listing page.
 * @param {object} recipe - The recipe data object from Firestore.
 * @returns {string} - The HTML string for the recipe card.
 */
function createBlogRecipeCard(recipe) {
    if (!recipe) return '';
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
    document.title = `${recipe.title} | Auto Meal Chef`;
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
        metaDescription.setAttribute('content', recipe.description);
    }

    const container = document.getElementById('recipe-content-container');
    if (!container) return;
    
    const imageUrl = recipe.imageUrl || `https://placehold.co/800x400/282828/FFF?text=${encodeURIComponent(recipe.title)}`;
    const ingredientsList = (recipe.ingredients || []).map(ing => `<li>${ing.quantity || ''} ${ing.unit || ''} ${ing.name || ''}</li>`.trim()).join('');
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

// Main function that runs after the page is loaded
document.addEventListener('DOMContentLoaded', async () => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const getPublicRecipes = httpsCallable(functions, 'getPublicRecipes');

    // --- LOGIC FOR SINGLE RECIPE PAGE ---
    // This code only runs if it finds the 'recipe-content-container' element
    const recipeContainer = document.getElementById('recipe-content-container');
    if (recipeContainer && params.has('slug')) {
        const slug = params.get('slug');
        try {
            const result = await getPublicRecipes({ slug: slug });
            if (result.data.recipe) {
                populateRecipePage(result.data.recipe);
            } else {
                 throw new Error("Recipe with that slug not found.");
            }
        } catch (error) {
            console.error("Error fetching single recipe:", error);
            recipeContainer.innerHTML = "<h1>Recipe not found</h1><p>Sorry, we couldn't find the recipe you were looking for.</p>";
        }
    } 
    
    // --- LOGIC FOR BLOG LISTING PAGE ---
    // This code only runs if it finds the 'recipe-grid-container' element
    const gridContainer = document.getElementById('recipe-grid-container');
    if (gridContainer) {
        try {
            const result = await getPublicRecipes({ limit: 21 });
            const recipes = result.data.recipes;
            if (recipes && recipes.length > 0) {
                const recipesByDate = {};
                
                recipes.forEach(recipe => {
                    if (recipe.createdAt && recipe.createdAt._seconds) {
                        const date = new Date(recipe.createdAt._seconds * 1000);
                        const dateString = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                        if (!recipesByDate[dateString]) recipesByDate[dateString] = [];
                        recipesByDate[dateString].push(recipe);
                    }
                });

                const sortedDates = Object.keys(recipesByDate).sort((a, b) => new Date(b) - new Date(a));
                let finalHtml = '';
                sortedDates.forEach(dateString => {
                    finalHtml += `<h2 class="blog-date-header">${dateString}</h2>`;
                    finalHtml += recipesByDate[dateString].map(createBlogRecipeCard).join('');
                });
                
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
    // This code only runs if it finds the 'daily-recipe-container' element
    const dailyRecipeContainer = document.getElementById('daily-recipe-container');
    if (dailyRecipeContainer) {
        try {
            const result = await getPublicRecipes({ limit: 1 });
            const recipes = result.data.recipes;
            if (recipes && recipes.length > 0) {
                const recipe = recipes[0];
                const recipeUrl = `/recipe?slug=${encodeURIComponent(recipe.slug)}`;
                dailyRecipeContainer.innerHTML = `
                    <div class="how-it-works-image">
                         <a href="${recipeUrl}"><img src="${recipe.imageUrl}" alt="${recipe.title}" onerror="this.onerror=null;this.src='https://placehold.co/1260x750/282828/FFF?text=Image+Not+Found';"></a>
                    </div>
                    <div class="step-text" style="text-align: left;">
                        <h4 style="font-size: 1.5rem; margin-bottom: 1rem;">${recipe.title}</h4>
                        <p>${recipe.description}</p>
                        <a href="${recipeUrl}" class="primary-btn">View Full Recipe <i class="fas fa-arrow-right"></i></a>
                    </div>
                `;
            }
        } catch (error) {
            console.error("Error fetching recipe of the day:", error);
            dailyRecipeContainer.innerHTML = '<p>Could not load today\'s recipe. Please try again later.</p>';
        }
    }
        
    // --- Demo Video ---
    const watchDemoBtn = document.getElementById('watch-demo-btn');
    const demoVideo = document.getElementById('demo-video');
    if (watchDemoBtn && demoVideo) {
        watchDemoBtn.addEventListener('click', () => {
             setTimeout(() => {
                demoVideo.play().catch(error => console.log('Autoplay was prevented:', error));
            }, 500);
        });
    }

    // --- Particle Background ---
    const particleContainer = document.getElementById('particle-background');
    if (particleContainer && typeof THREE !== 'undefined') {
        let scene, camera, renderer, particles;
        let windowHalfX = window.innerWidth / 2;
        let windowHalfY = window.innerHeight / 2;
        let mouseX = 0; let mouseY = 0;

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
            const material = new THREE.PointsMaterial({ color: 0x1DB954, size: 2, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
            particles = new THREE.Points(particlesGeometry, material);
            scene.add(particles);
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);
            particleContainer.appendChild(renderer.domElement);
            document.addEventListener('mousemove', (event) => {
                mouseX = (event.clientX - windowHalfX) / 2;
                mouseY = (event.clientY - windowHalfY) / 2;
            });
            window.addEventListener('resize', () => {
                windowHalfX = window.innerWidth / 2;
                windowHalfY = window.innerHeight / 2;
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            });
        }

        function animateParticles() {
            requestAnimationFrame(animateParticles);
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
});
