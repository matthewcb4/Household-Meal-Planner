// public/landing.js

// --- Import Firebase modules ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";


// --- Firebase configuration (copied from your app's script) ---
const firebaseConfig = {
  apiKey: "AIzaSyDcsZlszhp5v93YheCfjkOYdzwf7ZQ_nm8",
  authDomain: "family-dinner-app-79249.firebaseapp.com",
  projectId: "family-dinner-app-79249",
  storageBucket: "family-dinner-app-79249.firebasestorage.app",
  messagingSenderId: "665272276696",
  appId: "1:665272276696:web:f5aa5a5888f8abf97e69ad",
  measurementId: "G-LQ124BNWKH"
};

// --- Initialize Firebase for the landing page ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);


document.addEventListener('DOMContentLoaded', () => {
    // --- Mobile Menu Toggle ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mainHeader = document.querySelector('.main-header');

    mobileMenuBtn.addEventListener('click', () => {
        mainHeader.classList.toggle('open');
    });

    // --- Smooth Scrolling for Nav Links ---
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
             // Close mobile menu after clicking a link
            if (mainHeader.classList.contains('open')) {
                mainHeader.classList.remove('open');
            }
        });
    });

    // --- Demo Video Logic ---
    // This logic waits for a "Watch Demo" button click.
    // It will not do anything until the corresponding HTML is added to index.html.
    const watchDemoBtn = document.getElementById('watch-demo-btn');
    const demoVideo = document.getElementById('demo-video');

    if (watchDemoBtn && demoVideo) {
        // The smooth scroll is already handled by the generic 'a[href^="#"]' selector.
        // This adds auto-play functionality when the demo button is clicked.
        watchDemoBtn.addEventListener('click', () => {
             // A short delay allows the smooth scroll animation to start.
             setTimeout(() => {
                demoVideo.play().catch(error => {
                    // Autoplay was prevented. This is common in modern browsers.
                    // The video will still be visible with controls.
                    console.log('Autoplay was prevented:', error);
                });
            }, 500); // 500ms delay for scroll to start
        });
    }

    // --- Recipe of the Day Logic ---
    const dailyRecipeContainer = document.getElementById('daily-recipe-container');
    if (dailyRecipeContainer) {
        async function fetchRecipeOfTheDay() {
            try {
                // Call the secure Cloud Function instead of accessing Firestore directly
                const getPublicRecipes = httpsCallable(functions, 'getPublicRecipes');
                const result = await getPublicRecipes({}); // Call without args to get the latest list
                const recipes = result.data.recipes;

                if (!recipes || recipes.length === 0) {
                    dailyRecipeContainer.innerHTML = '<p>No recipe of the day found. Our AI is cooking one up, check back tomorrow!</p>';
                    return;
                }

                const recipe = recipes[0]; // The function returns them sorted, so the first is the latest
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

            } catch (error) {
                console.error("Error fetching recipe of the day:", error);
                dailyRecipeContainer.innerHTML = '<p>Could not load today\'s recipe. Please try again later.</p>';
            }
        }

        fetchRecipeOfTheDay();
    }

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
                color: 0x1DB954, // --primary-accent-color
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
});
