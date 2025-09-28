// public/script.js
// Import all necessary functions from the Firebase SDKs at the top
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, getDocs, onSnapshot, query, where, writeBatch, arrayUnion, serverTimestamp, deleteDoc, orderBy, deleteField, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";


// Your web app's Firebase configuration
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

// --- FIX: Initialize App Check immediately after Firebase App initialization ---
// App Check needs to be initialized BEFORE any other Firebase service (like Auth or Firestore) is used.
// This ensures that even the initial login request is verified.
try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('6Lcbe7krAAAAAHzpiTrO2meUKHrgpafT1vQ9o6sC'),
      isTokenAutoRefreshEnabled: true
    });
    console.log("App Check initialized successfully.");
} catch(error) {
    console.error("Error initializing App Check:", error);
}

const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app);
window.auth = auth; // Make auth globally available for admin tasks
// Make sure to replace this with your actual Stripe publishable key if it's different.
const stripe = Stripe('pk_live_51RwOcyPk8em715yUgWedIOa1K2lPO5GLVcRulsJwqQQvGSna5neExF97cikgW7PCdIjlE4zugr5DasBqAE0CTPaV00Pg771UkD');


// --- Start Auth Flow ---
// This consolidated block handles both redirect results and the standard auth state listener.
// It ensures that we check for a redirect result immediately on page load.
getRedirectResult(auth)
  .then((result) => {
    if (result) {
      // User just signed in via redirect. The onAuthStateChanged will handle it from here.
      console.log("Redirect result processed successfully.");
    }
    // Now, set up the normal auth state listener. This will run after the redirect is handled.
    onAuthStateChanged(auth, async user => {
        const initialView = document.getElementById('initial-view');
        const appContent = document.getElementById('app-content');
        const loginSection = document.getElementById('login-section');
        const householdManager = document.getElementById('household-manager');

        renderAuthUI(user);

        if (user) {
            // Check if the user is using email/password and if their email is verified
            const isEmailProvider = user.providerData.some(provider => provider.providerId === 'password');
            
            if (isEmailProvider && !user.emailVerified) {
                // If email is not verified, show a verification prompt instead of the app
                initialView.style.display = 'block';
                appContent.style.display = 'none';
                loginSection.style.display = 'none'; // Hide login form
                householdManager.style.display = 'block'; // Show a section
                householdManager.classList.add('active');
                householdManager.innerHTML = `
                    <div class="auth-view">
                        <h3><i class="fas fa-envelope"></i> Please Verify Your Email</h3>
                        <p>A verification link was sent to <strong>${user.email}</strong>.</p>
                        <p>Please check your email (including spam folder) and click the link to continue.</p>
                        <button id="resend-verification-email-btn">Resend Verification Email</button>
                        <button id="check-verification-status-btn" class="secondary">I've Verified, Continue</button>
                        <hr>
                        <button id="sign-out-unverified-btn" class="link-button">Use a different account</button>
                    </div>
                `;

                document.getElementById('resend-verification-email-btn').addEventListener('click', async () => {
                    try {
                        await sendEmailVerification(user);
                        showToast("Another verification email has been sent!");
                    } catch (error) {
                        console.error("Error resending verification email:", error);
                        showToast(`Error: ${error.message}`);
                    }
                });

                document.getElementById('check-verification-status-btn').addEventListener('click', async () => {
                    await user.reload();
                    if (auth.currentUser.emailVerified) {
                        window.location.reload(); // Simple way to re-trigger onAuthStateChanged
                    } else {
                        showToast("Email not verified yet. Please check your inbox.");
                    }
                });

                document.getElementById('sign-out-unverified-btn').addEventListener('click', () => signOut(auth));
            } else {
                // User is verified or using a different provider (like Google)
                await initializeAppUI(user);
            }
        } else {
            currentUser = null; householdId = null;
            unsubscribeHousehold();
            unsubscribeMealPlan();
            unsubscribeFavorites();

            buildLoginForm();

            initialView.style.display = 'block';
            loginSection.style.display = 'block';
            loginSection.classList.add('active');
            householdManager.style.display = 'none';
            householdManager.classList.remove('active');
            appContent.style.display = 'none';
        }
    });
  }).catch((error) => {
    console.error("Error processing redirect result:", error);
    showToast(`Login failed: ${error.message}`);
    // Even if redirect fails, still set up the auth listener as a fallback.
    onAuthStateChanged(auth, async user => {
        const initialView = document.getElementById('initial-view');
        const appContent = document.getElementById('app-content');
        const loginSection = document.getElementById('login-section');
        const householdManager = document.getElementById('household-manager');

        renderAuthUI(user);

        if (user) {
            await initializeAppUI(user);
        } else {
            currentUser = null; householdId = null;
            unsubscribeHousehold();
            unsubscribeMealPlan();
            unsubscribeFavorites();

            buildLoginForm();

            initialView.style.display = 'block';
            loginSection.style.display = 'block';
            loginSection.classList.add('active');
            householdManager.style.display = 'none';
            householdManager.classList.remove('active');
            appContent.style.display = 'none';
        }
    });
  });


// --- GLOBAL VARIABLES ---
let currentUser = null, householdId = null, stream = null, scanMode = 'pantry', currentDate = new Date(), unsubscribeHousehold = () => {}, unsubscribeMealPlan = () => {}, unsubscribeFavorites = () => {}, selectAllGroceryCheckbox = null, selectAllPantryCheckbox = null, currentRecipeToPlan = null, householdData = null, userPreferences = {};
let unitSystem = 'imperial';
let calendarDate = new Date();
let sidebarCalendarDate = new Date(); // NEW: Separate date for the sidebar calendar
let selectedDates = [];
let currentHowToSlide = 0;
let accumulatedRecipes = [];
let loadingInterval = null;
let isCameraOpen = false;
let currentTourStep = 0;
let tourSteps = [];
const PANTRY_CATEGORIES = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"];
// NEW: Sets to track open category states, initialized to be open by default
let openPantryCategories = new Set(PANTRY_CATEGORIES);
let openGroceryCategories = new Set(PANTRY_CATEGORIES);


const CUISINE_OPTIONS = ["American", "Asian", "French", "Greek", "Indian", "Italian", "Mediterranean", "Mexican", "Spanish", "Thai"];

// --- Function to create and manage the auth UI in the top bar ---
function renderAuthUI(user) {
    const authContainer = document.getElementById('auth-container');
    authContainer.innerHTML = ''; // Clear previous state
    const moreNavButton = document.querySelector('.mobile-only-nav');

    if (user) {
        authContainer.innerHTML = `
            <div class="auth-left">
                <h3 id="welcome-message">Hello, ${user.displayName || user.email}!</h3>
                <p id="household-status-info" style="display: none;"></p>
            </div>
            <div class="auth-right">
                <div id="household-info" class="household-code-container" style="display: none;"></div>
                <button id="sign-out-btn" class="danger">Sign Out</button>
            </div>
        `;
        document.getElementById('sign-out-btn').addEventListener('click', () => signOut(auth));
        const upgradeBtn = document.getElementById('upgrade-btn-header');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', handleUpgradeClick);
        }
        if (moreNavButton) moreNavButton.style.display = 'list-item'; // Show the 'More' button
    } else {
        authContainer.innerHTML = `<button id="login-main-btn">Login / Sign Up</button>`;
        document.getElementById('login-main-btn').addEventListener('click', () => {
            const initialView = document.getElementById('initial-view');
            const appContent = document.getElementById('app-content');
            const loginSection = document.getElementById('login-section');
            const householdManager = document.getElementById('household-manager');
            initialView.style.display = 'block';
            appContent.style.display = 'none';
            loginSection.style.display = 'block';
            loginSection.classList.add('active');
            householdManager.style.display = 'none';
            householdManager.classList.remove('active');
        });
        if (moreNavButton) moreNavButton.style.display = 'none'; // Hide the 'More' button
    }
}

// --- Function to build the login form when needed ---
function buildLoginForm() {
    const loginSection = document.getElementById('login-section');
    loginSection.innerHTML = `
        <div class="auth-view">
            <h3>Welcome to Auto Meal Chef</h3>
            <div id="sign-in-options">
                <button id="sign-in-btn" class="social-signin-btn google"><i class="fab fa-google"></i> Sign in with Google</button>
                <hr class="auth-divider">
                <div id="email-auth-container">
                    <form id="email-signin-form">
                        <input type="email" id="email-input" placeholder="Email" required>
                        <input type="password" id="password-input" placeholder="Password" required>
                        <button type="submit" id="email-signin-btn">Sign In</button>
                    </form>
                    <form id="email-signup-form" style="display: none;">
                        <input type="email" id="signup-email-input" placeholder="Email" required>
                        <input type="password" id="signup-password-input" placeholder="Password" required>
                        <input type="text" id="signup-display-name-input" placeholder="Display Name" required>
                        <button type="submit" id="email-signup-btn">Sign Up</button>
                    </form>
                    <p id="auth-error" class="auth-error-message" style="display: none;"></p>
                    <button id="toggle-auth-mode" class="link-button">Need an account? Sign Up</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('sign-in-btn').addEventListener('click', handleGoogleSignIn);
    document.getElementById('email-signin-form').addEventListener('submit', handleEmailSignIn);
    document.getElementById('email-signup-form').addEventListener('submit', handleEmailSignUp);
    document.getElementById('toggle-auth-mode').addEventListener('click', toggleAuthMode);
}

// --- NAVIGATION LOGIC ---
function switchView(targetId) {
    document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    document.getElementById(targetId).classList.add('active');
    const activeLink = document.querySelector(`.nav-link[data-target="${targetId}"]`);
    if (activeLink) activeLink.classList.add('active');
}

// --- HELPER FUNCTIONS ---
function showToast(message) {
    const toast = document.getElementById('toast-notification');
    toast.textContent = message;
    toast.className = 'show';
    setTimeout(() => { toast.className = toast.className.replace('show', ''); }, 3000);
}
// NEW: Helper to get today's date as a YYYY-MM-DD string
function getTodayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
const delay = ms => new Promise(res => setTimeout(res, ms));
function escapeAttr(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function getPantryRef() {
    if (!householdId) return null;
    return collection(db, 'households', householdId, 'pantryItems');
}
function getGroceryListRef() {
    if (!householdId) return null;
    return collection(db, 'households', householdId, 'groceryListItems');
}
function getFavoritesRef() {
    if (!householdId) return null;
    return collection(db, 'households', householdId, 'favoriteRecipes');
}
function getWeekId(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
function getMealPlanRefForDate(date) {
    if (!householdId) return null;
    const weekId = getWeekId(date);
    return doc(db, 'households', householdId, 'mealPlan', weekId);
}
function getMealPlanRef() {
    return getMealPlanRefForDate(currentDate);
}
function populateCategoryDropdown(selectElement) {
    if (!selectElement) return;
    selectElement.innerHTML = '';
    PANTRY_CATEGORIES.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        selectElement.appendChild(option);
    });
}
function populateCuisineDropdowns() {
    const selects = [document.getElementById('cuisine-select'), document.getElementById('household-cuisine-select')];
    selects.forEach(select => {
        if (select) {
            const currentValue = select.value;
            const anyOption = select.querySelector('option[value=""]');
            select.innerHTML = '';
            if (anyOption) select.appendChild(anyOption);
            CUISINE_OPTIONS.forEach(cuisine => {
                const option = document.createElement('option');
                option.value = cuisine;
                option.textContent = cuisine;
                select.appendChild(option);
            });
            select.value = currentValue;
        }
    });
}
function showLoadingState(message, container, append = false) {
    if (!container) return;
    if (loadingInterval) clearInterval(loadingInterval);

    const loaderHTML = `
        <div class="loading-card" id="loading-indicator">
            <div class="chef-loader"><i class="fas fa-hat-chef"></i></div>
            <p id="loading-text"></p>
        </div>`;

    if (append) {
        const existingLoader = document.getElementById('loading-indicator');
        if (!existingLoader) {
            container.insertAdjacentHTML('afterbegin', loaderHTML);
        }
    } else {
        container.innerHTML = loaderHTML;
    }

    const loadingTextEl = document.getElementById('loading-text');

    if (Array.isArray(message)) {
        let messageIndex = 0;
        loadingTextEl.textContent = message[messageIndex];
        loadingInterval = setInterval(() => {
            messageIndex = (messageIndex + 1) % message.length;
            loadingTextEl.textContent = message[messageIndex];
        }, 2500);
    } else {
        loadingTextEl.textContent = message;
    }
}


// --- UI DISPLAY FUNCTIONS ---
async function displayPantryItems() {
    const pantryListDiv = document.getElementById('pantry-list');
    const pantryBulkControls = document.getElementById('pantry-bulk-controls');
    const pantryRef = getPantryRef();
    if (!pantryRef) return;

    // Use onSnapshot for real-time updates
    onSnapshot(query(pantryRef), (snapshot) => {
        if (snapshot.empty) {
            pantryListDiv.innerHTML = '<li>Your household pantry is empty!</li>';
            pantryBulkControls.style.display = 'none';
            return;
        }

        pantryBulkControls.style.display = 'flex';
        const groupedItems = {};
        snapshot.forEach(doc => {
            const item = { id: doc.id, ...doc.data() };
            const category = item.category || 'Other';
            if (!groupedItems[category]) { groupedItems[category] = []; }
            groupedItems[category].push(item);
        });

        pantryListDiv.innerHTML = '';
        PANTRY_CATEGORIES.forEach(category => {
            if (groupedItems[category]) {
                const categoryHeader = document.createElement('h4');
                categoryHeader.className = 'category-header';
                
                const list = document.createElement('ul');

                // MODIFIED: Check against openPantryCategories to set initial state
                if (openPantryCategories.has(category)) {
                    list.style.display = 'block';
                    categoryHeader.innerHTML = `${category}<span class="category-toggle">−</span>`;
                } else {
                    list.style.display = 'none'; // Initially collapsed
                    categoryHeader.innerHTML = `${category}<span class="category-toggle">+</span>`;
                }
                
                pantryListDiv.appendChild(categoryHeader);

                groupedItems[category].sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
                    const listItem = document.createElement('li');
                    listItem.className = `pantry-item ${item.checked ? 'checked' : ''}`;
                    listItem.innerHTML = `
                        <div class="item-info">
                             <input type="checkbox" class="pantry-item-checkbox" data-id="${item.id}" ${item.checked ? 'checked' : ''}>
                            <span>${item.name} (${item.quantity} ${item.unit})</span>
                        </div>
                        <button class="delete-pantry-item-btn danger" data-id="${item.id}">X</button>
                    `;
                    list.appendChild(listItem);
                });
                pantryListDiv.appendChild(list);
            }
        });
        handlePantryItemCheck();
    });
}


function updateWeekView() {
    displayWeekRange();
    displayMealPlan();
    renderSidebarCalendar();
}

async function displayGroceryList() {
    const groceryList = document.getElementById('grocery-list');
    const groceryBulkControls = document.getElementById('grocery-bulk-controls');
    const groceryRef = getGroceryListRef();
    if (!groceryRef) return;
    groceryList.innerHTML = '<p>Loading grocery list...</p>';
    const q = query(groceryRef, orderBy("createdAt"));
    
    // Using onSnapshot for real-time updates
    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            groceryList.innerHTML = '<p>Your grocery list is empty!</p>';
            groceryBulkControls.style.display = 'none';
            return;
        }

        groceryBulkControls.style.display = 'flex';
        const groupedItems = {};
        snapshot.forEach(doc => {
            const item = { id: doc.id, ...doc.data() };
            const category = item.category || 'Other';
            if (!groupedItems[category]) { groupedItems[category] = []; }
            groupedItems[category].push(item);
        });

        groceryList.innerHTML = '';
        PANTRY_CATEGORIES.forEach(category => {
            if (groupedItems[category]) {
                const categoryHeader = document.createElement('h4');
                categoryHeader.className = 'category-header';
                
                const list = document.createElement('ul');
                
                // MODIFIED: Check against openGroceryCategories
                if (openGroceryCategories.has(category)) {
                    list.style.display = 'block';
                    categoryHeader.innerHTML = `${category}<span class="category-toggle">−</span>`;
                } else {
                    list.style.display = 'none';
                    categoryHeader.innerHTML = `${category}<span class="category-toggle">+</span>`;
                }

                groceryList.appendChild(categoryHeader);

                groupedItems[category].sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
                    const listItem = document.createElement('li');
                    listItem.className = `grocery-item ${item.checked ? 'checked' : ''}`;
                    const quantityText = item.quantity ? ` <span class="item-quantity">(${item.quantity})</span>` : '';
                    listItem.innerHTML = `
                        <div class="item-info">
                            <input type="checkbox" data-id="${item.id}" ${item.checked ? 'checked' : ''}>
                            <label>${item.name}${quantityText}</label>
                        </div>
                        <div class="grocery-item-controls">
                            <a href="https://www.walmart.com/search?q=${encodeURIComponent(item.name)}" target="_blank" class="walmart-search-btn" title="Search on Walmart"><span>Walmart</span></a>
                            <button class="delete-grocery-btn" data-id="${item.id}">X</button>
                        </div>
                    `;
                    list.appendChild(listItem);
                });
                groceryList.appendChild(list);
            }
        });
        handleGroceryItemCheck();
    });
}

function displayFavoriteRecipes(docs) {
    const favoriteRecipesContainer = document.getElementById('favorite-recipes-container');
    if (!docs) {
        favoriteRecipesContainer.innerHTML = '<p>Loading favorites...</p>';
        return;
    }
    if (docs.length === 0) {
        favoriteRecipesContainer.innerHTML = '<p>You haven\'t saved any favorite recipes yet.</p>';
        return;
    }

    const groupedByMealType = {};
    docs.forEach(doc => {
        const recipe = { id: doc.id, ...doc.data() };
        const mealType = recipe.mealType || 'uncategorized';
        if (!groupedByMealType[mealType]) {
            groupedByMealType[mealType] = [];
        }
        groupedByMealType[mealType].push(recipe);
    });

    favoriteRecipesContainer.innerHTML = '';
    Object.keys(groupedByMealType).sort().forEach(mealType => {
        const mealTypeTitle = mealType.charAt(0).toUpperCase() + mealType.slice(1);
        const categoryHeader = document.createElement('h4');
        categoryHeader.className = 'favorite-category-title';
        categoryHeader.textContent = mealTypeTitle;
        favoriteRecipesContainer.appendChild(categoryHeader);

        const list = document.createElement('div');
        list.className = 'recipe-card-row';

        groupedByMealType[mealType].forEach(recipe => {
            const recipeCard = createRecipeCard(recipe, true);
            list.appendChild(recipeCard);
        });
        favoriteRecipesContainer.appendChild(list);
    });
}

function displayWeekRange() {
    const weekRangeDisplay = document.getElementById('week-range-display');
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    weekRangeDisplay.textContent = `${startOfWeek.toLocaleDateString()} - ${endOfWeek.toLocaleDateString()}`;
}

function renderMealPlanner() {
    const mealPlannerGrid = document.getElementById('meal-planner-grid');
    mealPlannerGrid.innerHTML = '';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();
    const currentDayIndex = today.getDay();

    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const isCurrentWeek = today >= startOfWeek && today <= endOfWeek;
    const isMobile = window.innerWidth <= 768;

    days.forEach((day, index) => {
        const dayCard = document.createElement('div');
        dayCard.className = 'day-card';
        if (isMobile) {
            dayCard.classList.add('collapsed');
        }

        if (isCurrentWeek && index === currentDayIndex) {
            dayCard.classList.add('today');
        }

        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        // FIX: Add premium-feature class to the plan-day-btn
        dayHeader.innerHTML = `
            <span>${day}</span>
            <button class="plan-day-btn secondary premium-feature" data-day="${day.toLowerCase()}" data-day-full-name="${fullDayNames[index]}">✨</button>
        `;

        dayHeader.addEventListener('click', (e) => {
            if (!e.target.closest('.plan-day-btn')) {
                dayCard.classList.toggle('collapsed');
            }
        });

        dayCard.appendChild(dayHeader);

        const dailyCuisineSelector = document.createElement('div');
        dailyCuisineSelector.className = 'daily-cuisine-selector premium-feature';
        const select = document.createElement('select');
        select.className = 'daily-cuisine-select';
        select.dataset.day = day.toLowerCase();
        let optionsHTML = '<option value="">Household Cuisine</option>';
        CUISINE_OPTIONS.forEach(c => {
            optionsHTML += `<option value="${c}">${c}</option>`;
        });
        select.innerHTML = optionsHTML;
        dailyCuisineSelector.appendChild(select);
        dayCard.appendChild(dailyCuisineSelector);


        ['Breakfast', 'Lunch', 'Dinner'].forEach(meal => {
            const mealSlotContainer = document.createElement('div');
            mealSlotContainer.className = 'meal-slot-container';

            const mealLabel = document.createElement('div');
            mealLabel.className = 'meal-label';
            mealLabel.textContent = meal;

            const mealSlot = document.createElement('div');
            mealSlot.className = 'meal-slot';
            mealSlot.dataset.day = day.toLowerCase();
            mealSlot.dataset.meal = meal.toLowerCase();

            mealSlot.addEventListener('dragover', handleDragOver);
            mealSlot.addEventListener('dragleave', handleDragLeave);
            mealSlot.addEventListener('drop', handleDrop);

            mealSlotContainer.appendChild(mealLabel);
            mealSlotContainer.appendChild(mealSlot);
            dayCard.appendChild(mealSlotContainer);
        });

        mealPlannerGrid.appendChild(dayCard);
    });
    configurePaywallUI();
}

async function displayMealPlan() {
    renderMealPlanner();
    const mealPlanRef = getMealPlanRef();
    if (!mealPlanRef) return;

    unsubscribeMealPlan();
    unsubscribeMealPlan = onSnapshot(mealPlanRef, (doc) => {
        document.querySelectorAll('.meal-slot').forEach(slot => {
            slot.innerHTML = '';
        });

        if (doc.exists()) {
            const plan = doc.data();
            const meals = plan.meals || {};

            Object.keys(meals).forEach(day => {
                if(meals[day]) {
                    Object.keys(meals[day]).forEach(meal => {
                        const slot = document.querySelector(`.meal-slot[data-day="${day}"][data-meal="${meal}"]`);
                        if (slot && meals[day][meal]) {
                            Object.entries(meals[day][meal]).forEach(([mealId, recipe]) => {
                                const recipeDiv = document.createElement('div');
                                recipeDiv.className = 'recipe-title';
                                recipeDiv.style.backgroundImage = `url(${recipe.imageUrl || `https://placehold.co/600x400/EEE/31343C?text=${encodeURIComponent(recipe.title)}`})`;
                                recipeDiv.innerHTML = `<span>${recipe.title}</span>`;
                                recipeDiv.draggable = true;
                                recipeDiv.dataset.recipe = JSON.stringify(recipe);
                                recipeDiv.dataset.mealId = mealId;
                                recipeDiv.dataset.day = day;
                                recipeDiv.dataset.meal = meal;
                                recipeDiv.addEventListener('dragstart', handleCalendarDragStart);
                                slot.appendChild(recipeDiv);
                            });
                        }
                    });
                }
            });
        }
        renderSidebarCalendar();
    });
}

function renderAddToPlanCalendar(year, month) {
    const calendarGrid = document.getElementById('calendar-grid');
    const monthYearDisplay = document.getElementById('calendar-month-year');
    if (!calendarGrid || !monthYearDisplay) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize today's date

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    monthYearDisplay.textContent = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });
    calendarGrid.innerHTML = '';

    // Add day names
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
        const dayNameEl = document.createElement('div');
        dayNameEl.className = 'calendar-day-name';
        dayNameEl.textContent = day;
        calendarGrid.appendChild(dayNameEl);
    });

    // Add empty cells for the start of the month
    for (let i = 0; i < firstDay; i++) {
        calendarGrid.appendChild(document.createElement('div'));
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.textContent = day;

        const thisDate = new Date(year, month, day);
        thisDate.setHours(0, 0, 0, 0);

        // Format date as YYYY-MM-DD for the dataset
        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        dayEl.dataset.date = dateString;

        if (thisDate.getTime() === today.getTime()) {
            dayEl.classList.add('today');
        }

        if (selectedDates.includes(dateString)) {
            dayEl.classList.add('selected');
        }

        calendarGrid.appendChild(dayEl);
    }
}


async function addRecipeToPlan(dateObject, meal, recipe) {
    const dayAbbr = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dateObject.getUTCDay()];
    const mealPlanRef = getMealPlanRefForDate(dateObject);
    if (!mealPlanRef) return;

    const mealEntryId = `meal_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const recipeToSave = { ...recipe, rating: 0 };

    try {
        await setDoc(mealPlanRef, { meals: { [dayAbbr]: { [meal]: { [mealEntryId]: recipeToSave } } } }, { merge: true });
    } catch (error) {
        console.error("Error adding recipe to plan:", error);
    }
}

function handleGroceryItemCheck() {
    const groceryList = document.getElementById('grocery-list');
    const moveToPantryBtn = document.getElementById('move-to-pantry-btn');
    const deleteSelectedGroceryBtn = document.getElementById('delete-selected-grocery-btn');

    const allItemCheckboxes = groceryList.querySelectorAll('.grocery-item input[type="checkbox"]');
    const checkedItems = groceryList.querySelectorAll('.grocery-item input[type="checkbox"]:checked');

    moveToPantryBtn.style.display = checkedItems.length > 0 ? 'inline-block' : 'none';
    deleteSelectedGroceryBtn.style.display = checkedItems.length > 0 ? 'inline-block' : 'none';

    groceryList.querySelectorAll('.grocery-item').forEach(li => {
        const checkbox = li.querySelector('input');
        if (checkbox && checkbox.checked) {
            li.classList.add('checked');
        } else {
            li.classList.remove('checked');
        }
    });

    if (selectAllGroceryCheckbox) {
        const container = selectAllGroceryCheckbox.parentElement.parentElement;
        if (allItemCheckboxes.length === 0) {
            container.style.display = 'none';
        } else {
            container.style.display = 'flex';
            if (checkedItems.length === allItemCheckboxes.length && allItemCheckboxes.length > 0) {
                selectAllGroceryCheckbox.checked = true;
                selectAllGroceryCheckbox.indeterminate = false;
            } else if (checkedItems.length > 0) {
                selectAllGroceryCheckbox.checked = false;
                selectAllGroceryCheckbox.indeterminate = true;
            } else {
                selectAllGroceryCheckbox.checked = false;
                selectAllGroceryCheckbox.indeterminate = false;
            }
        }
    }
}

function handleSelectAllGrocery(event) {
    const groceryList = document.getElementById('grocery-list');
    const isChecked = event.target.checked;
    const allCheckboxes = groceryList.querySelectorAll('.grocery-item input[type="checkbox"]');
    allCheckboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
    });
    handleGroceryItemCheck();
}

function handlePantryItemCheck() {
    const pantryListDiv = document.getElementById('pantry-list');
    const pantryBulkControls = document.getElementById('pantry-bulk-controls');
    const deleteSelectedPantryBtn = document.getElementById('delete-selected-pantry-btn');

    const allItemCheckboxes = pantryListDiv.querySelectorAll('.pantry-item-checkbox');
    const checkedItems = pantryListDiv.querySelectorAll('.pantry-item-checkbox:checked');

    deleteSelectedPantryBtn.style.display = checkedItems.length > 0 ? 'inline-block' : 'none';

    if (selectAllPantryCheckbox) {
        if (allItemCheckboxes.length === 0) {
            pantryBulkControls.style.display = 'none';
        } else {
            pantryBulkControls.style.display = 'flex';
            if (checkedItems.length === allItemCheckboxes.length && allItemCheckboxes.length > 0) {
                selectAllPantryCheckbox.checked = true;
                selectAllPantryCheckbox.indeterminate = false;
            } else if (checkedItems.length > 0) {
                selectAllPantryCheckbox.checked = false;
                selectAllPantryCheckbox.indeterminate = true;
            } else {
                selectAllPantryCheckbox.checked = false;
                selectAllPantryCheckbox.indeterminate = false;
            }
        }
    }
}

async function handleSelectAllPantry(event) {
    const isChecked = event.target.checked;
    const pantryRef = getPantryRef();
    if (!pantryRef) return;

    const allCheckboxes = document.querySelectorAll('.pantry-item-checkbox');
    if (allCheckboxes.length === 0) return;

    const batch = writeBatch(db);
    allCheckboxes.forEach(checkbox => {
        const itemRef = doc(pantryRef, checkbox.dataset.id);
        batch.update(itemRef, { checked: isChecked });
    });
    await batch.commit();
}

function handleCalendarDragStart(event) {
    const target = event.target.closest('.recipe-title');
    const recipeData = target.dataset.recipe;
    const sourceInfo = {
        recipe: JSON.parse(recipeData),
        source: {
            day: target.dataset.day,
            meal: target.dataset.meal,
            mealId: target.dataset.mealId
        }
    };
    event.dataTransfer.setData('application/json', JSON.stringify(sourceInfo));
    event.dataTransfer.effectAllowed = 'move';
}

async function handleDrop(event) {
    event.preventDefault();
    const slot = event.target.closest('.meal-slot');
    if (!slot) return;

    slot.classList.remove('drag-over');
    const dataString = event.dataTransfer.getData('application/json');
    if (!dataString) return;

    const data = JSON.parse(dataString);
    const targetDay = slot.dataset.day;
    const targetMeal = slot.dataset.meal;

    if (data.source) { // It's a move from within the calendar
        const { recipe, source } = data;
        const mealPlanRef = getMealPlanRef();
        const batch = writeBatch(db);

        const deletePath = `meals.${source.day}.${source.meal}.${source.mealId}`;
        batch.update(mealPlanRef, { [deletePath]: deleteField() });

        const newMealId = `meal_${Date.now()}`;
        const addPath = `meals.${targetDay}.${targetMeal}.${newMealId}`;
        batch.set(mealPlanRef, { meals: { [targetDay]: { [targetMeal]: { [newMealId]: recipe } } } }, { merge: true });

        await batch.commit();
    } else { // It's a new recipe from the list
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        const dayIndex = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(targetDay);
        const targetDate = new Date(startOfWeek);
        targetDate.setDate(startOfWeek.getDate() + dayIndex);

        await addRecipeToPlan(targetDate, targetMeal, data);
    }
}

function handleDragOver(event) {
    event.preventDefault();
    const slot = event.target.closest('.meal-slot');
    if (slot) {
        slot.classList.add('drag-over');
    }
}

function handleDragLeave(event) {
    const slot = event.target.closest('.meal-slot');
    if (slot) {
        slot.classList.remove('drag-over');
    }
}

// --- EVENT HANDLER FUNCTIONS ---

function handlePantryClick(event) {
    const target = event.target;

    // If a checkbox or delete button was clicked, handle that action specifically.
    if (target.matches('.pantry-item-checkbox, .delete-pantry-item-btn')) {
        if (target.classList.contains('delete-pantry-item-btn')) {
            const itemId = target.dataset.id;
            if (confirm("Are you sure you want to remove this item from your pantry?")) {
                deleteDoc(doc(getPantryRef(), itemId));
            }
        }

        if (target.classList.contains('pantry-item-checkbox')) {
            const checkbox = target;
            const itemId = checkbox.dataset.id;
            const isChecked = checkbox.checked;
            const pantryRef = getPantryRef();
            if (pantryRef && itemId) {
                const itemRef = doc(pantryRef, itemId);
                updateDoc(itemRef, { checked: isChecked });
            }
        }
        return; // Stop the function here to prevent collapsing the category.
    }

    // If the click was on the header itself, toggle the list.
    const header = target.closest('.category-header');
    if (header) {
        const categoryName = header.textContent.replace(/[+−]$/, '').trim();
        const list = header.nextElementSibling;
        const toggle = header.querySelector('.category-toggle');
        if (list && list.tagName === 'UL') {
            const isVisible = list.style.display !== 'none';
            list.style.display = isVisible ? 'none' : 'block';
            if (toggle) toggle.textContent = isVisible ? '+' : '−';
            // MODIFIED: Update the state of open categories
            if (isVisible) {
                openPantryCategories.delete(categoryName);
            } else {
                openPantryCategories.add(categoryName);
            }
        }
    }
}


async function handleManualAdd(event) {
    event.preventDefault();
    const pantryRef = getPantryRef();
    if (!pantryRef) return;
    const name = document.getElementById('manual-name').value.trim().toLowerCase();
    const quantity = parseFloat(document.getElementById('manual-quantity').value);
    const unit = document.getElementById('manual-unit').value.trim();
    const category = document.getElementById('manual-category').value;
    if (name && !isNaN(quantity) && quantity > 0) {
        const q = query(pantryRef, where('name', '==', name));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docToUpdate = querySnapshot.docs[0];
            const existingQuantity = docToUpdate.data().quantity || 0;
            await updateDoc(docToUpdate.ref, { quantity: existingQuantity + quantity });
        } else {
            await addDoc(pantryRef, { name, quantity, unit, category, checked: false, addedBy: currentUser.email });
        }

        document.getElementById('manual-add-form').reset();
        document.getElementById('pantry-forms-container').style.display = 'none';
    }
}

async function addItemsToPantry() {
    const itemConfirmationList = document.getElementById('item-confirmation-list');
    const pantryRef = getPantryRef();
    if (!pantryRef) {
        showToast("Error: Not in a household. Cannot add items to pantry.");
        return;
    }
    const confirmedItems = itemConfirmationList.querySelectorAll('.confirmation-item');
    if (confirmedItems.length === 0) {
        showToast("No items to add!");
        return;
    }

    const pantrySnapshot = await getDocs(pantryRef);
    const existingPantryItems = {};
    pantrySnapshot.forEach(doc => {
        existingPantryItems[doc.data().name.toLowerCase()] = { id: doc.id, ...doc.data() };
    });

    const batch = writeBatch(db);
    confirmedItems.forEach(itemEl => {
        const name = itemEl.querySelector('.item-name').value.trim().toLowerCase();
        const quantity = parseFloat(itemEl.querySelector('.item-quantity').value);
        const unit = itemEl.querySelector('.item-unit').value.trim();
        const category = itemEl.querySelector('.item-category').value;

        if (name && !isNaN(quantity) && quantity > 0) {
            if (existingPantryItems[name]) {
                const existingItem = existingPantryItems[name];
                const newQuantity = (existingItem.quantity || 0) + quantity;
                const itemRef = doc(pantryRef, existingItem.id);
                batch.update(itemRef, { quantity: newQuantity });
            } else {
                const newItemRef = doc(pantryRef);
                batch.set(newItemRef, { name, quantity, unit, category, checked: false, addedBy: currentUser.email, createdAt: serverTimestamp() });
            }
        }
    });
    await batch.commit();
    document.getElementById('confirmation-section').style.display = 'none';
    document.getElementById('pantry-forms-container').style.display = 'none';
}

// --- RECIPE FUNCTIONS (MODIFIED) ---
function createRecipeCard(recipe, isFavorite) {
    const recipeCard = document.createElement('div');
    recipeCard.className = 'recipe-card';

    if (isFavorite && recipe.id) {
        recipeCard.dataset.recipeId = recipe.id;
    }

    const imageUrl = recipe.imageUrl || `https://placehold.co/600x400/333/FFF?text=${encodeURIComponent(recipe.imageQuery || recipe.title)}`;
    // UPDATE: Track the image source, defaulting to pexels for originals
    const imageSource = recipe.imageSource || 'pexels';

    let ratingHTML = '';
    if (isFavorite) {
        ratingHTML = '<div class="star-rating">';
        for (let i = 1; i <= 5; i++) {
            ratingHTML += `<span class="star ${i <= (recipe.rating || 0) ? 'filled' : ''}" data-rating="${i}" data-id="${recipe.id}">★</span>`;
        }
        ratingHTML += '</div>';
    }
    
    let nutritionHTML = '';
    if (recipe.nutrition) {
        nutritionHTML = `
            <div class="nutrition-info">
                <div class="nutrition-item">
                    <span class="nutrition-value">${recipe.nutrition.calories || 'N/A'}</span>
                    <span>Calories</span>
                </div>
                <div class="nutrition-item">
                    <span class="nutrition-value">${recipe.nutrition.protein || 'N/A'}</span>
                    <span>Protein</span>
                </div>
                <div class="nutrition-item">
                    <span class="nutrition-value">${recipe.nutrition.carbs || 'N/A'}</span>
                    <span>Carbs</span>
                </div>
                 <div class="nutrition-item">
                    <span class="nutrition-value">${recipe.nutrition.fat || 'N/A'}</span>
                    <span>Fat</span>
                </div>
            </div>
        `;
    }

    const servingSizeHTML = recipe.servingSize ? `<div class="serving-size-info"><i class="fas fa-user-friends"></i> ${recipe.servingSize}</div>` : '';

    const cardContent = `
        <div class="recipe-card-header">
             <h3>${recipe.title}</h3>
        </div>
        ${servingSizeHTML}
        ${ratingHTML}
        <p>${recipe.description}</p>
        ${nutritionHTML}
    `;

    recipeCard.innerHTML = `
        <div class="image-container" data-image-source="${imageSource}">
            <img src="${imageUrl}" alt="${recipe.title}" class="recipe-image" onerror="this.onerror=null;this.src='https://placehold.co/600x400/333/FFF?text=Image+Not+Found';">
            <button class="swap-image-btn secondary" data-query="${escapeAttr(recipe.imageQuery || recipe.title)}"><span class="tooltip-text">Change Image</span>🔄</button>
        </div>
        <button class="save-recipe-btn ${isFavorite ? 'is-favorite' : ''}" title="${isFavorite ? 'Remove from Favorites' : 'Save to Favorites'}">⭐</button>
        <div class="recipe-card-content">${cardContent}</div>
    `;

    recipeCard.dataset.recipe = JSON.stringify(recipe);
    return recipeCard;
}


function populateRecipeDetailModal(recipe, isFavorite) {
    const modalContent = document.getElementById('recipe-detail-content');
    const imageUrl = recipe.imageUrl || `https://placehold.co/600x400/333/FFF?text=${encodeURIComponent(recipe.imageQuery || recipe.title)}`;
    const imageSource = recipe.imageSource || 'pexels';
    const googleSearchQuery = encodeURIComponent(`${recipe.title} recipe`);
    const googleSearchUrl = `https://www.google.com/search?q=${googleSearchQuery}`;


    const ingredientsList = (recipe.ingredients && Array.isArray(recipe.ingredients))
        ? recipe.ingredients.map(ing => {
            const ingredientText = `${ing.quantity || ''} ${ing.unit || ''} ${ing.name || ''}`.trim();
            const ingredientName = ing.name || '';
            const ingredientCategory = ing.category || 'Other';
            if (ingredientName) {
                return `<li>${ingredientText} <button class="add-to-list-btn secondary" data-item-name="${escapeAttr(ingredientName)}" data-item-category="${escapeAttr(ingredientCategory)}">+ List</button></li>`;
            }
            return '';
        }).join('')
        : '';

    const ingredientsHTML = `
        <div class="ingredients-container">
            <button class="ingredients-toggle secondary">Ingredients</button>
            <div class="ingredients-list" style="display: none;">
                <ul>${ingredientsList}</ul>
            </div>
        </div>
    `;

    let instructionsHTML = '';
    if (householdData && householdData.subscriptionTier === 'paid' && recipe.instructions && recipe.instructions.length > 0) {
        const instructionsList = recipe.instructions.map(step => `<li>${step}</li>`).join('');
        instructionsHTML = `
            <div class="instructions-container">
                <button class="instructions-toggle secondary premium">Show Instructions</button>
                <div class="instructions-list" style="display: none;">
                    <h4>Instructions</h4>
                    <ol>${instructionsList}</ol>
                </div>
            </div>
        `;
    } else {
         instructionsHTML = `
            <div class="instructions-container disabled">
                 <button class="instructions-toggle secondary">Show Instructions</button>
                 <div class="premium-overlay">
                     <span class="premium-tag">Premium</span>
                 </div>
            </div>
        `;
    }
    
    let nutritionHTML = '';
    if (recipe.nutrition) {
        nutritionHTML = `
            <div class="nutrition-info">
                 <div class="nutrition-item">
                    <span class="nutrition-value">${recipe.nutrition.calories || 'N/A'}</span>
                    <span>Calories</span>
                </div>
                <div class="nutrition-item">
                    <span class="nutrition-value">${recipe.nutrition.protein || 'N/A'}</span>
                    <span>Protein</span>
                </div>
                <div class="nutrition-item">
                    <span class="nutrition-value">${recipe.nutrition.carbs || 'N/A'}</span>
                    <span>Carbs</span>
                </div>
                 <div class="nutrition-item">
                    <span class="nutrition-value">${recipe.nutrition.fat || 'N/A'}</span>
                    <span>Fat</span>
                </div>
            </div>
        `;
    }
    
    const swapButtonHTML = `<button class="swap-image-btn secondary" data-query="${escapeAttr(recipe.imageQuery || recipe.title)}" title="Find a new image">🔄 Change Image</button>`;
    const cardActionsHTML = `<div class="card-actions"><button class="add-to-plan-btn">Add to Plan</button></div>`;

    let ratingHTML = '';
    if (isFavorite) {
        ratingHTML = '<div class="star-rating">';
        for (let i = 1; i <= 5; i++) {
            ratingHTML += `<span class="star ${i <= (recipe.rating || 0) ? 'filled' : ''}" data-rating="${i}" data-id="${recipe.id}">★</span>`;
        }
        ratingHTML += '</div>';
    }

    const servingSizeHTML = recipe.servingSize ? `<div class="serving-size-info"><i class="fas fa-user-friends"></i> ${recipe.servingSize}</div>` : '';

    modalContent.innerHTML = `
        <div class="image-container" data-image-source="${imageSource}">
            <span class="close-btn" id="recipe-detail-modal-close-btn">&times;</span>
            <img src="${imageUrl}" alt="${recipe.title}" class="recipe-image" onerror="this.onerror=null;this.src='https://placehold.co/600x400/EEE/31343C?text=Image+Not+Found';">
            ${swapButtonHTML}
        </div>
        <h3><a href="${googleSearchUrl}" target="_blank" title="Search on Google">${recipe.title} 🔗</a></h3>
        ${servingSizeHTML}
        ${ratingHTML}
        <p>${recipe.description}</p>
        ${nutritionHTML}
        ${cardActionsHTML}
        ${ingredientsHTML}
        ${instructionsHTML}
    `;

    modalContent.dataset.recipe = JSON.stringify(recipe);
    if (isFavorite && recipe.id) {
        modalContent.dataset.recipeId = recipe.id;
    }
    document.getElementById('recipe-detail-modal').style.display = 'block';
}


function displayRecipeResults(recipes, mealType) {
    if (loadingInterval) {
        clearInterval(loadingInterval);
        loadingInterval = null;
    }
    const recipeResultsDiv = document.getElementById('recipe-results');
    const existingLoader = document.getElementById('loading-indicator');
    if (existingLoader) {
        existingLoader.remove();
    }

    // Always re-render the full list from the accumulated array.
    recipeResultsDiv.innerHTML = "";

    if (!recipes || recipes.length === 0) {
        recipeResultsDiv.innerHTML = `<p>The AI couldn't think of any ${mealType} recipes with the selected criteria.</p>`;
        return;
    }

    const favoritesRef = getFavoritesRef();
    getDocs(favoritesRef).then(favSnapshot => {
        const favoriteTitles = new Set(favSnapshot.docs.map(doc => doc.data().title));

        recipes.forEach(recipe => {
            const isFavorite = favoriteTitles.has(recipe.title);
            if(isFavorite) {
                const favDoc = favSnapshot.docs.find(d => d.data().title === recipe.title);
                if (favDoc) recipe.id = favDoc.id;
            }
            if (!recipe.mealType) {
                recipe.mealType = mealType;
            }
            const recipeCard = createRecipeCard(recipe, isFavorite);
            recipeResultsDiv.appendChild(recipeCard);
        });
    });
}


async function getRecipeSuggestions() {
    await generateRecipes(null, 'Suggest from Pantry', true);
}

async function discoverNewRecipes() {
    await generateRecipes(null, 'Discover New Recipes', true); // Append new recipes
}

// UPDATED: This function now correctly handles scanned items vs. the full pantry.
async function generateRecipes(items, source, append = false) {
    const recipeResultsDiv = document.getElementById('recipe-results');
    const discoverBtn = document.getElementById('discover-recipes-btn');
    const suggestBtn = document.getElementById('suggest-recipe-btn');

    if (!append) {
        accumulatedRecipes = []; // Clear recipes for a new search
    }

    const selectedMealType = document.querySelector('input[name="mealType"]:checked').value;
    const selectedCuisine = document.getElementById('cuisine-select').value;
    const selectedCriteria = Array.from(document.querySelectorAll('input[name="recipeCriteria"]:checked')).map(cb => cb.value);

    const loadingMessages = [
        `Whipping up ${selectedCuisine || ''} ${selectedMealType} ideas...`,
        "Consulting with master chefs...",
        "Sourcing the freshest concepts...",
        "Plating your recipes now..."
    ];

    showLoadingState(loadingMessages, recipeResultsDiv, append);
    recipeResultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });

    discoverBtn.disabled = true;
    suggestBtn.disabled = true;

    try {
        let result;
        const commonPayload = {
            mealType: selectedMealType,
            cuisine: selectedCuisine,
            criteria: selectedCriteria,
            unitSystem: unitSystem
        };

        if (source === 'Suggest from Pantry') {
            // FIX: Use provided items (from photo scan) if available, otherwise fetch the full pantry.
            let ingredientsForSuggestion = [];
            if (items && items.length > 0) {
                ingredientsForSuggestion = items; // Use items from the photo scan
            } else {
                const pantryRef = getPantryRef();
                const snapshot = await getDocs(pantryRef);
                ingredientsForSuggestion = snapshot.docs.map(doc => doc.data().name); // Use full pantry
            }

            if (ingredientsForSuggestion.length === 0) {
                if (items) { // This means it came from a scan
                    recipeResultsDiv.innerHTML = "<p>Couldn't identify any items in the photo to suggest recipes from.</p>";
                } else { // This means it came from the pantry button
                    recipeResultsDiv.innerHTML = "<p>Your pantry is empty. Add some items to get suggestions.</p>";
                }
                return;
            }
            const suggestRecipesFunc = httpsCallable(functions, 'suggestRecipes');
            result = await suggestRecipesFunc({ ...commonPayload, pantryItems: ingredientsForSuggestion });
        } else { // This handles "Discover New Recipes"
            const discoverRecipesFunc = httpsCallable(functions, 'discoverRecipes');
            result = await discoverRecipesFunc(commonPayload);
        }

        const { recipes: newRecipes, remaining, isPremium } = result.data;

        if (remaining !== undefined) {
            showToast(`${remaining} ${isPremium ? '' : 'free '}suggestion(s) remaining today.`);
        }

        accumulatedRecipes.unshift(...newRecipes);
        if (accumulatedRecipes.length > 18) {
            accumulatedRecipes.length = 18;
        }
        displayRecipeResults(accumulatedRecipes, selectedMealType);

        const todayString = getTodayDateString();
        const suggestionsRef = doc(db, 'households', householdId, 'dailySuggestions', todayString);
        await setDoc(suggestionsRef, { recipes: accumulatedRecipes, createdAt: serverTimestamp() });


    } catch (error) {
        console.error("Error getting recipes:", error);
        if (loadingInterval) clearInterval(loadingInterval);
        const existingLoader = document.getElementById('loading-indicator');
        if (existingLoader) existingLoader.remove();
        if (!append) {
            recipeResultsDiv.innerHTML = `<p>Sorry, couldn't get recipe suggestions: ${error.message}</p>`;
        } else {
            showToast(`Could not fetch more recipes: ${error.message}`);
        }
    } finally {
        discoverBtn.disabled = false;
        suggestBtn.disabled = false;
    }
}


// UPDATED: This function is now fully refactored to handle all scan modes,
// close the camera immediately, and delegate to the correct confirmation UI.
async function captureAndScan() {
    const canvasElement = document.getElementById('capture-canvas');
    const videoElement = document.getElementById('camera-stream');
    const context = canvasElement.getContext('2d');

    // 1. Capture the image data
    const MAX_WIDTH = 800;
    const scale = MAX_WIDTH / videoElement.videoWidth;
    canvasElement.width = MAX_WIDTH;
    canvasElement.height = videoElement.videoHeight * scale;
    context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    const base64ImageData = canvasElement.toDataURL('image/jpeg', 0.8).split(',')[1];

    // 2. Immediately close the camera modal to provide instant feedback
    stopCamera();

    // 3. Determine the correct function and UI containers based on the scanMode
    let targetContainer, scanFunction, loadingMessage;

    switch (scanMode) {
        case 'quickMeal':
            targetContainer = document.getElementById('recipe-results');
            loadingMessage = 'Scanning ingredients and finding recipes...';
            scanFunction = httpsCallable(functions, 'identifyItems');
            break;
        case 'receipt':
            targetContainer = document.getElementById('item-confirmation-list');
            loadingMessage = '🧠 Reading receipt for Pantry...';
            scanFunction = httpsCallable(functions, 'scanReceipt');
            document.getElementById('pantry-forms-container').style.display = 'block';
            document.getElementById('confirmation-section').style.display = 'block';
            break;
        case 'groceryReceipt':
            targetContainer = document.getElementById('item-confirmation-list-grocery');
            loadingMessage = '🧠 Reading receipt for Grocery List...';
            scanFunction = httpsCallable(functions, 'scanReceipt');
            document.getElementById('grocery-forms-container').style.display = 'block';
            document.getElementById('confirmation-section-grocery').style.display = 'block';
            break;
        case 'grocery':
             targetContainer = document.getElementById('item-confirmation-list-grocery');
             loadingMessage = '🧠 Identifying items for Grocery List...';
             scanFunction = httpsCallable(functions, 'identifyItems');
             document.getElementById('grocery-forms-container').style.display = 'block';
             document.getElementById('confirmation-section-grocery').style.display = 'block';
             break;
        case 'pantry':
        default:
            targetContainer = document.getElementById('item-confirmation-list');
            loadingMessage = '🧠 Identifying items for Pantry...';
            scanFunction = httpsCallable(functions, 'identifyItems');
            document.getElementById('pantry-forms-container').style.display = 'block';
            document.getElementById('confirmation-section').style.display = 'block';
            break;
    }

    // 4. Show loading state in the appropriate main content area
    if (targetContainer) {
        if(scanMode === 'quickMeal') {
            showLoadingState(loadingMessage, targetContainer, true);
        } else {
             targetContainer.innerHTML = `<p>${loadingMessage}</p>`;
        }
    }

    // 5. Call the backend function and process the results
    try {
        const result = await scanFunction({ image: base64ImageData });
        const identifiedItems = result.data;

        if (!identifiedItems || identifiedItems.length === 0) {
             if(targetContainer) targetContainer.innerHTML = `<p>The AI couldn't identify any items. Please try again.</p>`;
             return;
        }

        if (scanMode === 'quickMeal') {
            const itemNames = identifiedItems.map(item => item.name);
            await generateRecipes(itemNames, 'Suggest from Pantry', true);
        } else if (scanMode === 'pantry' || scanMode === 'receipt') {
            displayConfirmationForm(identifiedItems);
        } else if (scanMode === 'grocery' || scanMode === 'groceryReceipt') {
            displayConfirmationFormGrocery(identifiedItems);
        }

    } catch (error) {
        console.error('Error calling scan function:', error);
        if (targetContainer) {
            targetContainer.innerHTML = `<p>Sorry, the AI scan failed: ${error.message}. Please try again.</p>`;
        }
    }
}


function displayConfirmationForm(items) {
    const itemConfirmationList = document.getElementById('item-confirmation-list');
    itemConfirmationList.innerHTML = '';
    if (!items || items.length === 0) {
        itemConfirmationList.innerHTML = `<p>The AI couldn't identify any items.</p>`;
        return;
    }
    items.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'confirmation-item';
        const categorySelectId = `category-select-${index}`;
        itemDiv.innerHTML = `
            <input type="text" class="item-name" value="${item.name.toLowerCase()}">
            <input type="number" class="item-quantity" value="1">
            <input type="text" class="item-unit" value="units">
            <select class="item-category" id="${categorySelectId}"></select>
            <button class="remove-item-btn">X</button>
        `;
        itemConfirmationList.appendChild(itemDiv);
        const categorySelect = document.getElementById(categorySelectId);
        populateCategoryDropdown(categorySelect);
        if (item.category && PANTRY_CATEGORIES.includes(item.category)) {
            categorySelect.value = item.category;
        }
    });
}

// NEW: Confirmation form specifically for the Grocery List
function displayConfirmationFormGrocery(items) {
    const itemConfirmationList = document.getElementById('item-confirmation-list-grocery');
    itemConfirmationList.innerHTML = '';
    if (!items || items.length === 0) {
        itemConfirmationList.innerHTML = `<p>The AI couldn't identify any items.</p>`;
        return;
    }

    items.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'confirmation-item'; // Re-use the same class for styling simplicity
        const categorySelectId = `grocery-category-select-${index}`;
        // Simplified for grocery list: just name and category
        itemDiv.innerHTML = `
            <input type="text" class="item-name" value="${item.name.toLowerCase()}">
            <select class="item-category" id="${categorySelectId}"></select>
            <button class="remove-item-btn">X</button>
        `;
        itemConfirmationList.appendChild(itemDiv);
        const categorySelect = document.getElementById(categorySelectId);
        populateCategoryDropdown(categorySelect);
        if (item.category && PANTRY_CATEGORIES.includes(item.category)) {
            categorySelect.value = item.category;
        }
    });
}


async function startCamera() {
    const videoElement = document.getElementById('camera-stream');
    const cameraContainer = document.getElementById('camera-container');
    const startCameraBtn = document.getElementById('start-camera-btn');
    const captureBtn = document.getElementById('capture-btn');
    const capturedImageElement = document.getElementById('captured-image');

    capturedImageElement.style.display = 'none';
    cameraContainer.style.display = 'block';
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        videoElement.srcObject = stream;
        startCameraBtn.style.display = 'none';
        captureBtn.style.display = 'block';
        isCameraOpen = true;
    } catch (err) {
        console.error("Error accessing camera: ", err);
        isCameraOpen = false;
    }
}

function stopCamera() {
    const videoElement = document.getElementById('camera-stream');
    const scanItemContainer = document.getElementById('scan-item-container');

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    videoElement.srcObject = null;
    isCameraOpen = false;

    scanItemContainer.style.display = 'none';
}

function toggleScanView(mode) {
    const scanItemContainer = document.getElementById('scan-item-container');
    if (scanItemContainer.style.display === 'flex') {
        stopCamera();
        return;
    }
    // Hide all forms before opening the camera
    document.getElementById('pantry-forms-container').style.display = 'none';
    document.getElementById('add-grocery-item-form').style.display = 'none';
    document.getElementById('grocery-forms-container').style.display = 'none';

    openCameraFor(mode);
}

function openCameraFor(mode) {
    const scanItemContainer = document.getElementById('scan-item-container');
    const startCameraBtn = document.getElementById('start-camera-btn');
    const captureBtn = document.getElementById('capture-btn');
    const capturedImage = document.getElementById('captured-image');

    scanMode = mode;
    scanItemContainer.style.display = 'flex';

    capturedImage.style.display = 'none';
    capturedImage.src = '';
    
    // Reset all confirmation forms
    document.getElementById('pantry-forms-container').style.display = 'none';
    document.getElementById('confirmation-section').style.display = 'none';
    document.getElementById('item-confirmation-list').innerHTML = '';
    document.getElementById('grocery-forms-container').style.display = 'none';
    document.getElementById('confirmation-section-grocery').style.display = 'none';
    document.getElementById('item-confirmation-list-grocery').innerHTML = '';


    startCameraBtn.style.display = 'block';
    captureBtn.style.display = 'none';
}

async function handleAddGroceryItem(event) {
    event.preventDefault();
    const groceryRef = getGroceryListRef();
    if (!groceryRef) return;
    const itemNameInput = document.getElementById('grocery-item-name');
    const itemQuantityInput = document.getElementById('grocery-item-quantity');
    const groceryItemCategorySelect = document.getElementById('grocery-item-category');

    const name = itemNameInput.value.trim();
    const quantity = itemQuantityInput.value.trim();
    const category = groceryItemCategorySelect.value;

    if (name) {
        await addDoc(groceryRef, {
            name: name,
            quantity: quantity,
            category: category,
            checked: false,
            createdAt: serverTimestamp()
        });

        // Reset form
        itemNameInput.value = '';
        itemQuantityInput.value = '1 item';

        // Hide form after adding
        document.getElementById('add-grocery-item-form').style.display = 'none';
    }
}

// NEW: Function to add confirmed scanned items to the grocery list
async function addItemsToGroceryList() {
    const itemConfirmationList = document.getElementById('item-confirmation-list-grocery');
    const groceryRef = getGroceryListRef();
    if (!groceryRef) {
        showToast("Error: Not in a household. Cannot add items.");
        return;
    }
    const confirmedItems = itemConfirmationList.querySelectorAll('.confirmation-item');
    if (confirmedItems.length === 0) {
        showToast("No items to add!");
        return;
    }

    const batch = writeBatch(db);
    confirmedItems.forEach(itemEl => {
        const name = itemEl.querySelector('.item-name').value.trim().toLowerCase();
        const category = itemEl.querySelector('.item-category').value;

        if (name) {
            const newItemRef = doc(groceryRef);
            batch.set(newItemRef, { name, category, checked: false, createdAt: serverTimestamp() });
        }
    });

    try {
        await batch.commit();
        showToast(`${confirmedItems.length} item(s) added to your grocery list.`);
        document.getElementById('grocery-forms-container').style.display = 'none';
        document.getElementById('confirmation-section-grocery').style.display = 'none';
    } catch (error) {
        console.error("Error adding items to grocery list:", error);
        showToast("An error occurred while adding items.");
    }
}


async function handleGroceryListClick(event) {
    const groceryRef = getGroceryListRef();
    if (!groceryRef) return;

    // MODIFIED: Handle category expand/collapse and state saving
    const header = event.target.closest('.category-header');
    if (header) {
        const categoryName = header.textContent.replace(/[+−]$/, '').trim();
        const list = header.nextElementSibling;
        const toggle = header.querySelector('.category-toggle');
        if (list && list.tagName === 'UL') {
            const isVisible = list.style.display !== 'none';
            list.style.display = isVisible ? 'none' : 'block';
            if(toggle) toggle.textContent = isVisible ? '+' : '−';
            // Update state
            if (isVisible) {
                openGroceryCategories.delete(categoryName);
            } else {
                openGroceryCategories.add(categoryName);
            }
        }
        return;
    }

    if (event.target.type === 'checkbox') {
        const itemId = event.target.dataset.id;
        const isChecked = event.target.checked;
        if (itemId) {
            const itemRef = doc(groceryRef, itemId);
            await updateDoc(itemRef, { checked: isChecked });
        }
        handleGroceryItemCheck(); // onSnapshot will update UI, but this updates button states immediately
    }

    if (event.target.classList.contains('delete-grocery-btn')) {
        const itemId = event.target.dataset.id;
        if (itemId) {
            if (confirm("Are you sure you want to remove this item from your grocery list?")) {
                await deleteDoc(doc(groceryRef, itemId));
                // displayGroceryList(); // onSnapshot handles this
            }
        }
    }
}


// --- HELPER: Parse a quantity string like "1.5 cups" into [1.5, "cups"] ---
function parseQuantity(quantityStr) {
    if (!quantityStr || typeof quantityStr !== 'string') {
        return [1, 'item'];
    }
    // Regex to separate numeric part from unit part
    const regex = /^([0-9./\s-]+)?\s*(.*)$/;
    const match = quantityStr.trim().match(regex);

    if (!match) {
        return [1, 'item'];
    }

    let numericPart = 0;
    const unitPart = match[2] ? match[2].trim() : 'item';

    if (match[1]) {
        try {
            const parts = match[1].trim().split(/\s+/);
            numericPart = parts.reduce((acc, part) => {
                if (part.includes('/')) {
                    const [top, bottom] = part.split('/');
                    return acc + (parseInt(top, 10) / parseInt(bottom, 10));
                }
                return acc + parseFloat(part);
            }, 0);
        } catch (e) {
            numericPart = 1; // Default to 1 if parsing fails
        }
    }

    // If no number was parsed, default to 1
    if (numericPart === 0) {
        numericPart = 1;
    }

    return [numericPart, unitPart || 'item'];
}


async function showMoveToPantryForm() {
    const groceryList = document.getElementById('grocery-list');
    const checkedItems = groceryList.querySelectorAll('input[type="checkbox"]:checked');
    if (checkedItems.length === 0) {
        showToast("Please select items to move.");
        return;
    }

    const modal = document.getElementById('move-to-pantry-modal');
    const form = document.getElementById('move-to-pantry-form');
    form.innerHTML = ''; // Clear previous form content

    const groceryRef = getGroceryListRef();
    if (!groceryRef) return;

    const itemIdsToMove = Array.from(checkedItems).map(cb => cb.dataset.id);
    const itemDocsPromises = itemIdsToMove.map(id => getDoc(doc(groceryRef, id)));
    const groceryItemSnapshots = await Promise.all(itemDocsPromises);

    groceryItemSnapshots.forEach(groceryItemDoc => {
        if (groceryItemDoc.exists()) {
            const item = groceryItemDoc.data();
            const [quantity, unit] = parseQuantity(item.quantity);

            const itemDiv = document.createElement('div');
            itemDiv.className = 'form-grid move-item-row';
            itemDiv.dataset.groceryItemId = groceryItemDoc.id;
            itemDiv.dataset.originalName = item.name;
            itemDiv.dataset.category = item.category || 'Other';

            itemDiv.innerHTML = `
                <label>${item.name}</label>
                <input type="number" class="move-quantity" value="${quantity}" step="0.1">
                <input type="text" class="move-unit" value="${unit}">
            `;
            form.appendChild(itemDiv);
        }
    });

    modal.style.display = 'block';
}

async function handleConfirmMoveToPantry() {
    const modal = document.getElementById('move-to-pantry-modal');
    const form = document.getElementById('move-to-pantry-form');
    const movedItems = form.querySelectorAll('.move-item-row');
    if (movedItems.length === 0) {
        showToast("No items to move.");
        return;
    }

    const pantryRef = getPantryRef();
    const groceryRef = getGroceryListRef();
    if (!pantryRef || !groceryRef) return;

    const batch = writeBatch(db);

    const pantrySnapshot = await getDocs(pantryRef);
    const existingPantryItems = {};
    pantrySnapshot.forEach(pantryDoc => {
        existingPantryItems[pantryDoc.data().name.toLowerCase()] = { id: pantryDoc.id, ...pantryDoc.data() };
    });

    movedItems.forEach(itemRow => {
        const name = itemRow.dataset.originalName.toLowerCase();
        const groceryItemId = itemRow.dataset.groceryItemId;
        const quantity = parseFloat(itemRow.querySelector('.move-quantity').value);
        const unit = itemRow.querySelector('.move-unit').value.trim();
        const category = itemRow.dataset.category;

        if (name && !isNaN(quantity) && quantity > 0) {
            if (existingPantryItems[name]) {
                const existingItem = existingPantryItems[name];
                // Simple quantity addition if units are the same, otherwise we just overwrite for simplicity.
                const newQuantity = (existingItem.unit.toLowerCase() === unit.toLowerCase())
                    ? (existingItem.quantity || 0) + quantity
                    : quantity;
                const itemRef = doc(pantryRef, existingItem.id);
                batch.update(itemRef, { quantity: newQuantity, unit: unit });
            } else {
                const newItemRef = doc(pantryRef);
                batch.set(newItemRef, { name, quantity, unit, category, checked: false, addedBy: currentUser.email, createdAt: serverTimestamp() });
            }
            // Delete from grocery list
            batch.delete(doc(groceryRef, groceryItemId));
        }
    });

    try {
        await batch.commit();
        showToast(`${movedItems.length} item(s) moved to pantry.`);
    } catch (error) {
        console.error("Error confirming move to pantry:", error);
        showToast("An error occurred while moving items.");
    } finally {
        // Hide the modal
        modal.style.display = 'none';
        form.innerHTML = '';
    }
}

async function handleAddFromRecipe(buttonElement) {
    if (!householdId) {
        showToast("Error: Household not found. Please sign in again.");
        return;
    }
    const itemName = buttonElement.dataset.itemName;
    const itemCategory = buttonElement.dataset.itemCategory || 'Other';
    const groceryRef = getGroceryListRef();
    if (groceryRef && itemName) {
        await addDoc(groceryRef, {
            name: itemName.toLowerCase(),
            category: itemCategory,
            checked: false,
            createdAt: serverTimestamp()
        });
        // onSnapshot handles display
        showToast(`'${itemName}' added to your grocery list!`);
    }
}

async function toggleFavorite(recipeData, buttonElement) {
    const favoritesRef = getFavoritesRef();
    if (!favoritesRef || !recipeData) return;

    const q = query(favoritesRef, where("title", "==", recipeData.title));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        const dataToSave = { ...recipeData };
        if (!dataToSave.mealType) {
            dataToSave.mealType = document.querySelector('input[name="mealType"]:checked').value || 'uncategorized';
        }
        delete dataToSave.id;
        // Ensure imageSource is saved when favoriting
        dataToSave.imageSource = dataToSave.imageSource || 'pexels';
        await addDoc(favoritesRef, dataToSave);
        showToast(`"${recipeData.title}" saved to favorites!`);
        if (buttonElement) {
            buttonElement.classList.add('is-favorite');
            buttonElement.title = 'Remove from Favorites';
        }
    } else {
        const docId = querySnapshot.docs[0].id;
        await deleteDoc(doc(favoritesRef, docId));
        showToast(`"${recipeData.title}" removed from favorites.`);
        if (buttonElement) {
            buttonElement.classList.remove('is-favorite');
            buttonElement.title = 'Save to Favorites';
        }
    }
}

// #############################################################################
// ### THIS IS THE UPDATED FUNCTION FOR THE IMAGE SWAP LOGIC ###
// #############################################################################
async function handleSwapImageClick(button) {
    const query = button.dataset.query;
    const card = button.closest('.recipe-card, .modal-content');
    if (!card || !query) return;

    const img = card.querySelector('.recipe-image');
    const imageContainer = card.querySelector('.image-container');
    const currentSource = imageContainer.dataset.imageSource || 'pexels';

    // Determine the next source to fetch from
    const newSourcePreference = currentSource === 'pexels' ? 'unsplash' : 'pexels';

    const recipeId = card.dataset.recipeId; // For favorites
    let recipeData = JSON.parse(card.dataset.recipe || '{}');

    // For meal plan items, details are in the parent .modal-recipe-item
    const mealPlanItem = button.closest('.modal-recipe-item');
    const mealPlanDetails = mealPlanItem ? {
        weekId: getWeekId(currentDate),
        day: mealPlanItem.dataset.day,
        meal: mealPlanItem.dataset.meal,
        mealId: mealPlanItem.dataset.id
    } : null;

    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    button.disabled = true;

    try {
        const getAlternateImage = httpsCallable(functions, 'getAlternateImage');
        const result = await getAlternateImage({ query, sourcePreference: newSourcePreference });
        const newImageUrl = result.data.imageUrl;

        if (newImageUrl) {
            img.src = newImageUrl;
            imageContainer.dataset.imageSource = newSourcePreference;

            // Create the payload for the update function
            const payload = { 
                newImageUrl: newImageUrl, 
                newImageSource: newSourcePreference 
            };

            const updateRecipeImage = httpsCallable(functions, 'updateRecipeImage');
            
            if (recipeId) {
                payload.recipeId = recipeId;
                await updateRecipeImage(payload);
                showToast(`Favorite recipe image updated from ${newSourcePreference}!`);
            } else if (mealPlanDetails) {
                payload.mealPlanDetails = mealPlanDetails;
                await updateRecipeImage(payload);
                showToast(`Meal plan image updated from ${newSourcePreference}!`);
            } else {
                payload.suggestionDetails = {
                    suggestionDate: getTodayDateString(),
                    recipeTitle: recipeData.title
                };
                await updateRecipeImage(payload);
                showToast(`Suggested recipe image updated from ${newSourcePreference}!`);
            }

            // Update the local recipe data on the card element
            recipeData.imageUrl = newImageUrl;
            recipeData.imageSource = newSourcePreference;
            card.dataset.recipe = JSON.stringify(recipeData);

        } else {
            showToast(`Couldn't find an image from ${newSourcePreference}.`);
        }
    } catch (error) {
        console.error("Error swapping image:", error);
        showToast(`Could not swap image: ${error.message}`);
    } finally {
        button.innerHTML = '🔄';
        if (button.closest('.modal-content')) {
             button.innerHTML = '🔄 Change Image';
        }
        button.disabled = false;
    }
}


async function handleCardClick(event) {
    const target = event.target;
    const card = target.closest('.recipe-card');
    if (!card) return;

    if (target.closest('.recipe-card-header a')) {
        return;
    }

    const recipeData = JSON.parse(card.dataset.recipe);

    if (target.closest('.save-recipe-btn')) {
        await toggleFavorite(recipeData, target.closest('.save-recipe-btn'));
    } else if (target.closest('.star')) {
        const recipeId = target.dataset.id;
        const newRating = parseInt(target.dataset.rating, 10);
        const favoritesRef = getFavoritesRef();
        if (favoritesRef && recipeId) {
            await updateDoc(doc(favoritesRef, recipeId), { rating: newRating });
        }
    } else if (target.closest('.swap-image-btn')) {
        handleSwapImageClick(target.closest('.swap-image-btn'));
    } else {
        const favoritesRef = getFavoritesRef();
        const q = query(favoritesRef, where("title", "==", recipeData.title));
        const querySnapshot = await getDocs(q);
        const isFavorite = !querySnapshot.empty;

        populateRecipeDetailModal(recipeData, isFavorite);
    }
}

// Helper function to render a list of recipes into a given container
function renderRecipeListToContainer(recipes, container, emptyMessage) {
    container.innerHTML = '';
    if (!recipes || recipes.length === 0) {
        container.innerHTML = `<p>${emptyMessage}</p>`;
        return;
    }

    const list = document.createElement('ul');
    list.className = 'select-meal-list';

    recipes.forEach(recipe => {
        const listItem = document.createElement('li');
        listItem.className = 'select-meal-item';
        listItem.dataset.recipe = JSON.stringify(recipe);

        const favIcon = recipe.isFavorite ? '⭐ ' : '';

        listItem.innerHTML = `
            <div class="select-meal-item-img">
                <img src="${recipe.imageUrl || `https://placehold.co/80x80/EEE/31343C?text=${encodeURIComponent(recipe.title)}`}" alt="${recipe.title}" loading="lazy">
            </div>
            <div class="select-meal-item-details">
                <h4>${favIcon}${recipe.title}</h4>
                <p>${(recipe.description || '').substring(0, 100)}...</p>
            </div>
        `;
        list.appendChild(listItem);
    });
    container.appendChild(list);
}


async function populateSelectMealModal(day, meal, fetchNew = false) {
    const favoritesListContainer = document.getElementById('select-meal-modal-favorites-list');
    const ideasListContainer = document.getElementById('select-meal-modal-ideas-list');

    // Set loading state for both tabs initially
    favoritesListContainer.innerHTML = '<div class="loading-spinner"></div>';
    ideasListContainer.innerHTML = '<div class="loading-spinner"></div>';

    try {
        // Fetch new suggestions ONLY if requested by the user.
        if (fetchNew) {
            const discoverRecipesFunc = httpsCallable(functions, 'discoverRecipes');
            const result = await discoverRecipesFunc({
                mealType: meal,
                cuisine: householdData?.cuisine || '',
                criteria: [],
                unitSystem: unitSystem
            });
            const { recipes: newRecipes, remaining } = result.data;
            if (newRecipes) {
                accumulatedRecipes.unshift(...newRecipes);
                // Also refresh the main recipe list in the background
                displayRecipeResults(accumulatedRecipes, 'ideas');
            }
            if (remaining !== undefined) {
                showToast(`${remaining} suggestion(s) remaining today.`);
            }
        }

        // 1. Fetch ALL favorite recipes for the "Favorites" tab.
        let favoriteRecipes = [];
        const favoritesRef = getFavoritesRef();
        if (favoritesRef) {
            const q = query(favoritesRef, orderBy("title"));
            const favSnapshot = await getDocs(q);
            favoriteRecipes = favSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, isFavorite: true }));
        }
        renderRecipeListToContainer(favoriteRecipes, favoritesListContainer, 'You have no favorite recipes yet. Star a recipe to add it here!');

        // 2. Populate "Recipe Ideas" tab with accumulated recipes.
        const favoriteTitles = new Set(favoriteRecipes.map(r => r.title));
        const uniqueExistingSuggestions = accumulatedRecipes.filter(r => !favoriteTitles.has(r.title));
        renderRecipeListToContainer(uniqueExistingSuggestions, ideasListContainer, 'No recipe ideas found. Use the "Recipes" tab to generate some!');

    } catch (error) {
        console.error("Error populating select meal modal:", error);
        favoritesListContainer.innerHTML = `<p>Sorry, couldn't load favorites: ${error.message}</p>`;
        ideasListContainer.innerHTML = `<p>Sorry, couldn't load ideas: ${error.message}</p>`;
    }
}

async function handleMealSlotClick(event) {
    const slot = event.target.closest('.meal-slot');
    if (!slot) return;

    const day = slot.dataset.day;
    const meal = slot.dataset.meal;
    const mealPlanRef = getMealPlanRef();
    const docSnap = await getDoc(mealPlanRef);
    const plan = docSnap.exists() ? docSnap.data() : {};
    const mealsForSlot = plan.meals?.[day]?.[meal];
    const isSlotEmpty = !mealsForSlot || Object.keys(mealsForSlot).length === 0;

    const modalTitle = `${day.charAt(0).toUpperCase() + day.slice(1)} ${meal.charAt(0).toUpperCase() + meal.slice(1)}`;

    if (isSlotEmpty) {
        // Open the new "select meal" modal
        const selectMealModal = document.getElementById('select-meal-modal');
        const selectMealModalTitle = document.getElementById('select-meal-modal-title');

        selectMealModalTitle.textContent = `Add to ${modalTitle}`;
        selectMealModal.style.display = 'block';

        // Store the target slot info for when a recipe is selected
        selectMealModal.dataset.day = day;
        selectMealModal.dataset.meal = meal;

        // Populate the modal with recipe suggestions, but don't fetch new ones initially
        populateSelectMealModal(day, meal, false);

    } else {
        // Open the existing "meal plan detail" modal
        const modalRecipeList = document.getElementById('modal-recipe-list');
        const modalSlotTitle = document.getElementById('modal-slot-title');
        const mealPlanModal = document.getElementById('meal-plan-modal');

        modalRecipeList.innerHTML = '';
        modalSlotTitle.textContent = modalTitle;

        Object.entries(mealsForSlot).forEach(([mealEntryId, recipe]) => {
            const recipeCard = document.createElement('div');
            recipeCard.className = 'recipe-card modal-recipe-item';
            const recipeWithSource = { ...recipe, source: { day, meal, mealId: mealEntryId } };
            recipeCard.dataset.recipe = JSON.stringify(recipeWithSource);
            recipeCard.dataset.day = day;
            recipeCard.dataset.meal = meal;
            recipeCard.dataset.id = mealEntryId;

            const imageUrl = recipe.imageUrl || `https://placehold.co/600x400/EEE/31343C?text=${encodeURIComponent(recipe.imageQuery || recipe.title)}`;
            const googleSearchQuery = encodeURIComponent(`${recipe.title} recipe`);
            const googleSearchUrl = `https://www.google.com/search?q=${googleSearchQuery}`;

            let ingredientsHTML = '<ul>';
            if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
                recipe.ingredients.forEach(ing => {
                     let ingredientText = (typeof ing === 'object' && ing !== null && ing.name) ? `${ing.quantity || ''} ${ing.unit || ''} ${ing.name}`.trim() : ing;
                     ingredientsHTML += `<li>${ingredientText}</li>`;
                });
            }
            ingredientsHTML += '</ul>';

            let instructionsHTML = '';
            if (householdData.subscriptionTier === 'paid' && recipe.instructions && recipe.instructions.length > 0) {
                const instructionsList = recipe.instructions.map(step => `<li>${step}</li>`).join('');
                instructionsHTML = `
                    <div class="instructions-container">
                        <button class="instructions-toggle secondary premium">Show Instructions</button>
                        <div class="instructions-list" style="display: none;">
                            <h4>Instructions</h4>
                            <ol>${instructionsList}</ol>
                        </div>
                    </div>
                `;
            }

            let ratingHTML = '<div class="star-rating">';
            for (let i = 1; i <= 5; i++) {
                ratingHTML += `<span class="star ${i <= (recipe.rating || 0) ? 'filled' : ''}" data-rating="${i}" data-day="${day}" data-meal="${meal}" data-id="${mealEntryId}">★</span>`;
            }
            ratingHTML += '</div>';

            let nutritionHTML = '';
            if (recipe.nutrition) {
                nutritionHTML = `
                    <div class="nutrition-info">
                        <div class="nutrition-item"><span class="nutrition-value">${recipe.nutrition.calories || 'N/A'}</span><span>Calories</span></div>
                        <div class="nutrition-item"><span class="nutrition-value">${recipe.nutrition.protein || 'N/A'}</span><span>Protein</span></div>
                        <div class="nutrition-item"><span class="nutrition-value">${recipe.nutrition.carbs || 'N/A'}</span><span>Carbs</span></div>
                        <div class="nutrition-item"><span class="nutrition-value">${recipe.nutrition.fat || 'N/A'}</span><span>Fat</span></div>
                    </div>
                `;
            }
            const servingSizeHTML = recipe.servingSize ? `<div class="serving-size-info"><i class="fas fa-user-friends"></i> ${recipe.servingSize}</div>` : '';

            recipeCard.innerHTML = `
                <button class="remove-from-plan-btn" data-day="${day}" data-meal="${meal}" data-id="${mealEntryId}">X</button>
                <div class="image-container">
                    <img src="${imageUrl}" alt="${recipe.title}" class="recipe-image" onerror="this.onerror=null;this.src='https://placehold.co/600x400/EEE/31343C?text=Image+Not+Found';">
                    <button class="swap-image-btn secondary" data-query="${escapeAttr(recipe.imageQuery || recipe.title)}">🔄</button>
                </div>
                <h3><a href="${googleSearchUrl}" target="_blank">${recipe.title} 🔗</a></h3>
                <div class="modal-card-actions">
                    <button class="favorite-from-modal-btn secondary">Favorite ⭐</button>
                    <button class="add-to-plan-btn secondary">Add to Plan Again</button>
                </div>
                ${servingSizeHTML}
                ${ratingHTML}
                <p>${recipe.description}</p>
                ${nutritionHTML}
                ${instructionsHTML}
                <strong>Ingredients:</strong>
                ${ingredientsHTML}
            `;
            modalRecipeList.appendChild(recipeCard);
        });
        mealPlanModal.style.display = 'block';
    }
}

async function handleModalClick(event) {
    const target = event.target;

    if (target.closest('.instructions-toggle, .ingredients-toggle')) {
        const button = target.closest('button');
        const list = button.nextElementSibling;
        if (list) {
            const isVisible = list.style.display === 'block';
            list.style.display = isVisible ? 'none' : 'block';
        }
        return;
    }

    // Handle clicks within the "select meal" modal
    const selectMealItem = target.closest('.select-meal-item');
    if (selectMealItem) {
        const selectMealModal = target.closest('#select-meal-modal');
        const recipe = JSON.parse(selectMealItem.dataset.recipe);
        const day = selectMealModal.dataset.day;
        const meal = selectMealModal.dataset.meal;

        // Calculate the target date based on the current week view
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        const dayIndex = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(day);
        const targetDate = new Date(startOfWeek);
        targetDate.setDate(startOfWeek.getDate() + dayIndex);

        await addRecipeToPlan(targetDate, meal, recipe);
        selectMealModal.style.display = 'none';
        return; // Exit after handling
    }

    const recipeDetailModal = target.closest('#recipe-detail-modal');
    if (recipeDetailModal) {
        const modalContent = recipeDetailModal.querySelector('#recipe-detail-content');
        const recipeData = JSON.parse(modalContent.dataset.recipe);

        if (target.closest('.add-to-plan-btn')) {
            currentRecipeToPlan = recipeData;
            document.getElementById('add-to-plan-recipe-title').textContent = currentRecipeToPlan.title;
            selectedDates = [];
            calendarDate = new Date();
            renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
            recipeDetailModal.style.display = 'none';
            document.getElementById('add-to-plan-modal').style.display = 'block';
        } else if (target.closest('.add-to-list-btn')) {
            await handleAddFromRecipe(target);
        } else if (target.closest('.swap-image-btn')) {
            handleSwapImageClick(target.closest('.swap-image-btn'));
        } else if (target.closest('.star')) {
            const recipeId = target.dataset.id;
            const newRating = parseInt(target.dataset.rating, 10);
            const favoritesRef = getFavoritesRef();
            if (favoritesRef && recipeId) {
                await updateDoc(doc(favoritesRef, recipeId), { rating: newRating });
                const starContainer = target.parentElement;
                const stars = starContainer.querySelectorAll('.star');
                stars.forEach(star => {
                    star.classList.toggle('filled', parseInt(star.dataset.rating, 10) <= newRating);
                });
            }
        }
    }

    const mealPlanItem = target.closest('.modal-recipe-item');
    if (mealPlanItem) {
        if (target.classList.contains('remove-from-plan-btn')) {
            const { day, meal, id } = target.dataset;
            const mealPlanRef = getMealPlanRef();
            const updatePath = `meals.${day}.${meal}.${id}`;
            await updateDoc(mealPlanRef, { [updatePath]: deleteField() });
            document.getElementById('meal-plan-modal').style.display = 'none';
        } else if (target.classList.contains('favorite-from-modal-btn')) {
            const recipeData = JSON.parse(mealPlanItem.dataset.recipe);
            await toggleFavorite(recipeData);
        } else if (target.classList.contains('add-to-plan-btn')) {
            currentRecipeToPlan = JSON.parse(mealPlanItem.dataset.recipe);
            document.getElementById('add-to-plan-recipe-title').textContent = currentRecipeToPlan.title;
            selectedDates = [];
            calendarDate = new Date();
            renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
            document.getElementById('meal-plan-modal').style.display = 'none';
            document.getElementById('add-to-plan-modal').style.display = 'block';
        } else if (target.classList.contains('star')) {
            const { rating, day, meal, id } = target.dataset;
            const mealPlanRef = getMealPlanRef();
            const updatePath = `meals.${day}.${meal}.${id}.rating`;
            await updateDoc(mealPlanRef, { [updatePath]: parseInt(rating, 10) });
        } else if (target.closest('.swap-image-btn')) {
            handleSwapImageClick(target.closest('.swap-image-btn'));
        }
    }
}

async function handleBulkDelete(collectionRef, checkedItemsSelector) {
    const checkedItems = document.querySelectorAll(checkedItemsSelector);
    if (checkedItems.length === 0) {
        showToast("Please select items to delete.");
        return;
    }
    if (confirm(`Are you sure you want to delete ${checkedItems.length} item(s)?`)) {
        const batch = writeBatch(db);
        checkedItems.forEach(checkbox => {
            batch.delete(doc(collectionRef, checkbox.dataset.id));
        });
        await batch.commit();
        // onSnapshot will update the UI
    }
}

function handleToggleAll(listElement, buttonElement) {
    const allLists = listElement.querySelectorAll('ul');
    if (allLists.length === 0) return;

    // Check if ANY list is collapsed to decide the action.
    // If even one is collapsed, we should expand all. Otherwise, collapse all.
    const shouldExpand = Array.from(allLists).some(list => list.style.display === 'none');
    
    const categorySet = listElement.id === 'pantry-list' ? openPantryCategories : openGroceryCategories;

    listElement.querySelectorAll('.category-header').forEach(header => {
        const categoryName = header.textContent.replace(/[+−]$/, '').trim();
        if (shouldExpand) {
            categorySet.add(categoryName);
        } else {
            categorySet.delete(categoryName);
        }
    });

    const allToggles = listElement.querySelectorAll('.category-toggle');
    allLists.forEach(list => list.style.display = shouldExpand ? 'block' : 'none');
    allToggles.forEach(toggle => toggle.textContent = shouldExpand ? '−' : '+');
    buttonElement.textContent = shouldExpand ? 'Collapse All' : 'Expand All';
}


function handleRemoveConfirmedItem(event) {
    if (event.target.classList.contains('remove-item-btn')) {
        event.target.closest('.confirmation-item').remove();
    }
}

function navigateWeek(direction) {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + (direction === 'prev' ? -7 : 7));
    currentDate = newDate;
    updateWeekView();
}

async function generateAutomatedGroceryList() {
    showToast("Generating grocery list...");
    try {
        const generateList = httpsCallable(functions, 'generateGroceryList');
        const result = await generateList({ weekId: getWeekId(currentDate) });
        if (result.data.success) {
            showToast(result.data.message);
            // displayGroceryList(); // onSnapshot handles this
        } else {
            throw new Error(result.data.error || "Unknown error");
        }
    } catch (error) {
        console.error("Error generating grocery list:", error);
        showToast(`Could not generate grocery list: ${error.message}`);
    }
}

function configurePaywallUI() {
    if (!householdData) return;
    const premiumFeatures = document.querySelectorAll('.premium-feature');
    const householdStatusInfo = document.getElementById('household-status-info');
    const updateCuisineBtn = document.getElementById('update-cuisine-btn');
    const cuisineSelect = document.getElementById('cuisine-select');

    let statusText = `Status: ${householdData.subscriptionTier.charAt(0).toUpperCase() + householdData.subscriptionTier.slice(1)}`;

    if (householdData.subscriptionTier === 'free') {
        const scansUsed = householdData.usage?.scan?.count || 0;
        const scansLeft = 20 - scansUsed;
        const tooltipHTML = `<span class="tooltip-container"><i class="fas fa-question-circle tooltip-icon"></i><span class="tooltip-text">Scans are used for AI features like identifying items from photos and receipts.</span></span>`;
        statusText += ` (Scans Left: ${scansLeft} / 20 ${tooltipHTML})`;
        
        premiumFeatures.forEach(el => {
            el.classList.add('disabled');
        });

        if (updateCuisineBtn && householdData.lastCuisineUpdate) {
            const lastUpdate = householdData.lastCuisineUpdate.toDate();
            const now = new Date();
            const thirtyDaysInMillis = 30 * 24 * 60 * 60 * 1000;

            if (now - lastUpdate < thirtyDaysInMillis) {
                updateCuisineBtn.textContent = `Update available on ${new Date(lastUpdate.getTime() + thirtyDaysInMillis).toLocaleDateString()}`;
            } else {
                updateCuisineBtn.textContent = 'Update Cuisine (1 free change)';
            }
            updateCuisineBtn.style.display = 'block';
        }
        if(cuisineSelect) cuisineSelect.value = householdData.cuisine || "";

    } else {
        premiumFeatures.forEach(el => {
            el.classList.remove('disabled');
            el.querySelectorAll('input, button, select').forEach(input => input.disabled = false);
        });
        if (updateCuisineBtn) {
            updateCuisineBtn.style.display = 'block';
            updateCuisineBtn.disabled = false;
            updateCuisineBtn.textContent = 'Update Cuisine';
        }
        if(cuisineSelect) {
            cuisineSelect.disabled = false;
            cuisineSelect.value = householdData.cuisine || "";
        }
    }
    if(householdStatusInfo) householdStatusInfo.innerHTML = statusText;
}

// NEW FUNCTION TO HANDLE PREFERENCE TOGGLES
function handlePreferenceChange(event) {
    const changedElement = event.target;

    // Sync checkboxes with the same value across different sections
    if (changedElement.type === 'checkbox' && changedElement.value) {
        const value = changedElement.value;
        const isChecked = changedElement.checked;
        document.querySelectorAll(`input[type="checkbox"][value="${value}"]`).forEach(checkbox => {
            if (checkbox !== changedElement) {
                checkbox.checked = isChecked;
            }
        });
    }

    // Now save the updated preferences
    saveUserPreferences();
}

// FIX: This function now saves all relevant criteria to the user's profile.
async function saveUserPreferences() {
    if (!currentUser) return;

    // Consolidate criteria from both planner and recipe sections
    const criteriaCheckboxes = document.querySelectorAll('input[name="plannerCriteria"], input[name="recipeCriteria"]');
    const allCriteria = new Set();
    criteriaCheckboxes.forEach(cb => {
        if (cb.checked) {
            allCriteria.add(cb.value);
        }
    });

    userPreferences.criteria = Array.from(allCriteria);
    userPreferences.unitSystem = document.querySelector('input[name="unitSystem"]:checked').value;

    const userDocRef = doc(db, 'users', currentUser.uid);
    await updateDoc(userDocRef, { preferences: userPreferences });
    showToast('Preferences saved!');
}

// FIX: This function now loads all relevant criteria from the user's profile.
function loadUserPreferences() {
    const savedCriteria = userPreferences.criteria || [];
    const savedUnitSystem = userPreferences.unitSystem || 'imperial';

    // Set criteria checkboxes across the app
    document.querySelectorAll('input[name="plannerCriteria"], input[name="recipeCriteria"]').forEach(checkbox => {
        checkbox.checked = savedCriteria.includes(checkbox.value);
    });

    // Set unit system radio buttons
    const unitRadio = document.querySelector(`input[name="unitSystem"][value="${savedUnitSystem}"]`);
    if (unitRadio) {
        unitRadio.checked = true;
    }
}

async function handlePlanSingleDayClick(event) {
    const button = event.target.closest('.plan-day-btn');
    if (!button || button.disabled) return;

    const dayAbbr = button.dataset.day;
    const dayFullName = button.dataset.dayFullName;

    if (!confirm(`This will fill in any empty meals for ${dayFullName}. Are you sure?`)) {
        return;
    }

    const originalButtonText = button.textContent;
    button.textContent = '...';
    button.disabled = true;

    const mealPlanRef = getMealPlanRef();
    const currentPlanDoc = await getDoc(mealPlanRef);
    const currentMeals = currentPlanDoc.exists() ? currentPlanDoc.data().meals : {};

    const existingMealsForDay = {
        breakfast: !!(currentMeals[dayAbbr] && Object.keys(currentMeals[dayAbbr].breakfast || {}).length > 0),
        lunch: !!(currentMeals[dayAbbr] && Object.keys(currentMeals[dayAbbr].lunch || {}).length > 0),
        dinner: !!(currentMeals[dayAbbr] && Object.keys(currentMeals[dayAbbr].dinner || {}).length > 0),
    };

    if (existingMealsForDay.breakfast && existingMealsForDay.lunch && existingMealsForDay.dinner) {
        showToast(`${dayFullName} is already fully planned!`);
        button.textContent = originalButtonText;
        button.disabled = false;
        return;
    }

    const plannerCriteria = Array.from(document.querySelectorAll('input[name="plannerCriteria"]:checked')).map(cb => cb.value);
    const dailyCuisineSelect = document.querySelector(`.daily-cuisine-select[data-day="${dayAbbr}"]`);
    const dailyCuisine = dailyCuisineSelect ? dailyCuisineSelect.value : '';
    const finalCuisine = dailyCuisine || (householdData ? householdData.cuisine : '');
    if (finalCuisine) {
        plannerCriteria.push(finalCuisine);
    }

    let pantryItems = [];
    const usePantryCheckbox = document.getElementById('use-pantry-items-checkbox');
    if (usePantryCheckbox && usePantryCheckbox.checked) {
        const pantryRef = getPantryRef();
        const snapshot = await getDocs(pantryRef);
        pantryItems = snapshot.docs.map(doc => doc.data().name);
    }

    try {
        const planSingleDayFunc = httpsCallable(functions, 'planSingleDay');
        const result = await planSingleDayFunc({
            day: dayFullName,
            criteria: plannerCriteria,
            pantryItems: pantryItems,
            existingMeals: existingMealsForDay
        });
        const newDayPlan = result.data;

        if (newDayPlan && Object.keys(newDayPlan).length > 0) {
            await setDoc(mealPlanRef, { meals: { [dayAbbr]: newDayPlan } }, { merge: true });
        }

    } catch (error) {
        console.error(`Error planning ${dayFullName}:`, error);
        showToast(`Could not plan ${dayFullName}: ${error.message}`);
    } finally {
        button.textContent = originalButtonText;
        button.disabled = false;
    }
}

function listenToFavorites() {
    const favoritesRef = getFavoritesRef();
    if (!favoritesRef) return;

    unsubscribeFavorites();
    unsubscribeFavorites = onSnapshot(query(favoritesRef), (snapshot) => {
        displayFavoriteRecipes(snapshot.docs);
    });
}

// --- ONBOARDING TOUR FUNCTIONS (MODIFIED) ---
async function waitForElement(selector, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const el = document.querySelector(selector);
        if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) { // Check if element is visible
            return el;
        }
        await delay(250); // Poll every 250ms
    }
    return null; // Return null if timed out
}

function defineTourSteps() {
    const isMobile = window.innerWidth <= 768;
    tourSteps = [
        {
            element: '.sidebar-nav a[data-target="pantry-section"]',
            title: 'Step 1: Your Pantry',
            content: 'This is where you manage all the ingredients you have at home. Let\'s add your first item!',
            placement: isMobile ? 'top' : 'right',
            onBefore: () => {
                switchView('pantry-section');
            }
        },
        {
            element: '#show-manual-add-btn',
            title: 'Add Items',
            content: 'You can add items manually, scan a single item\'s image, or even scan a whole receipt (a premium feature!). Let\'s add one manually.',
            placement: isMobile ? 'bottom' : 'bottom'
        },
        {
            element: '#manual-add-form',
            title: 'Enter Item Details',
            content: 'Fill in the name, quantity, and unit for your item. For example, "2 lbs Chicken Breast". Then click "Add".',
            placement: isMobile ? 'top': 'bottom',
            onBefore: () => {
                switchView('pantry-section'); // Ensures we're on the right tab when going backward
                document.getElementById('pantry-forms-container').style.display = 'block';
                document.getElementById('manual-add-container').style.display = 'block';
            }
        },
        {
            element: '.sidebar-nav a[data-target="recipe-section"]',
            title: 'Step 2: Find Recipes',
            content: 'Now that you have something in your pantry, let\'s find a recipe. Go to the Recipes section.',
            placement: isMobile ? 'top' : 'right',
            onBefore: () => {
                document.getElementById('pantry-forms-container').style.display = 'none';
                switchView('recipe-section');
            }
        },
        {
            element: '#suggest-recipe-btn',
            title: 'Get Suggestions',
            content: 'Click "Next" and we\'ll get some AI-powered recipe suggestions based on what\'s currently in your pantry.',
            placement: isMobile ? 'top' : 'top',
            shouldClick: true
        },
        {
            element: '#recipe-results .recipe-card:first-child',
            title: 'Your First Recipe!',
            content: 'Here is a recipe suggestion. Click "Next" to see more details.',
            placement: 'top',
            isOptional: true,
            shouldClick: true
        },
        {
            element: '#recipe-detail-content .add-to-plan-btn',
            title: 'Step 3: Add to Your Plan',
            content: 'Like the recipe? Click "Next" to add it to your weekly meal plan.',
            placement: 'top',
            shouldClick: true,
            onBefore: async () => {
                if (document.getElementById('recipe-detail-modal').style.display !== 'block') {
                    const firstCard = await waitForElement('#recipe-results .recipe-card:first-child');
                    if (firstCard) {
                        firstCard.click();
                        await waitForElement('#recipe-detail-modal');
                    }
                }
            }
        },
         {
            element: '#calendar-grid',
            title: 'Select a Day',
            content: 'Choose one or more days on the calendar to add this recipe to.',
            placement: 'top',
            onBefore: async () => {
                if (document.getElementById('add-to-plan-modal').style.display !== 'block') {
                    const btn = await waitForElement('#recipe-detail-content .add-to-plan-btn');
                    if (btn) btn.click();
                    await waitForElement('#add-to-plan-modal');
                }
            }
        },
        {
            element: '#meal-select',
            title: 'Confirm',
            content: 'Select a mealtime and click "Add to Plan" to finalize.',
            placement: 'top'
        },
        {
            element: '.sidebar-nav a[data-target="meal-plan-section"]',
            title: 'Step 4: View Your Plan',
            content: 'Great! Your meal is now on the planner. You can view, organize, and generate a grocery list from here.',
            placement: isMobile ? 'top' : 'right',
            onBefore: async () => {
                const addToPlanModal = document.getElementById('add-to-plan-modal');
                if (addToPlanModal.style.display === 'block') {
                    const firstDay = await waitForElement('.calendar-day[data-date]');
                    if (firstDay) firstDay.click();
                    document.getElementById('meal-select').value = 'dinner';
                    document.querySelector('#add-to-plan-form button[type="submit"]').click();
                    await delay(500);
                }
                switchView('meal-plan-section');
            }
        },
        {
            title: 'Tour Complete!',
            content: 'You\'ve learned the basics! Explore the app to discover more features like the Community tab and premium perks. Enjoy your meal planning!',
            isFinal: true
        }
    ];
}

function startTour() {
    defineTourSteps();
    currentTourStep = 0;
    document.getElementById('tour-overlay').style.display = 'block';
    showTourStep();
}

// MODIFIED: Re-ordered logic to correctly calculate tooltip position on mobile.
async function showTourStep() {
    const step = tourSteps[currentTourStep];
    const tooltip = document.getElementById('tour-tooltip');
    const overlay = document.getElementById('tour-overlay');

    // Always clean up previous state first
    document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
    overlay.style.pointerEvents = 'auto'; // Block clicks by default

    // 1. Render the new content into the tooltip
    tooltip.innerHTML = `
        <h4>${step.title}</h4>
        <p>${step.content}</p>
        <div class="tour-navigation">
            <span class="tour-step-counter">${currentTourStep + 1} / ${tourSteps.length}</span>
            <div>
                ${currentTourStep > 0 ? '<button id="tour-prev-btn" class="secondary">Prev</button>' : ''}
                <button id="tour-next-btn">${step.isFinal ? 'Finish' : 'Next'}</button>
            </div>
        </div>
        <button id="tour-skip-btn" class="link-button">Skip Tour</button>
    `;
    document.getElementById('tour-next-btn').addEventListener('click', nextTourStep);
    if (document.getElementById('tour-prev-btn')) {
        document.getElementById('tour-prev-btn').addEventListener('click', prevTourStep);
    }
    document.getElementById('tour-skip-btn').addEventListener('click', endTour);

    // Make the tooltip visible but off-screen to measure it accurately
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';

    if (step.isFinal) {
        // Center the final step's tooltip
        tooltip.style.left = '50%';
        tooltip.style.top = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
    } else {
        // Run any pre-step actions (like switching views)
        if (step.onBefore) {
            await step.onBefore();
        }

        const targetElement = await waitForElement(step.element);

        if (!targetElement) {
            if (step.isOptional) {
                nextTourStep(); // Skip optional step if element not found
                return;
            }
            console.warn(`Tour element not found and timed out: ${step.element}`);
            showToast("Something went wrong with the tour, skipping ahead.");
            endTour();
            return;
        }

        targetElement.classList.add('tour-highlight');
        overlay.style.pointerEvents = 'none'; // Allow clicks to pass through to the highlighted element

        // 2. Now that content is rendered, get accurate dimensions
        const targetRect = targetElement.getBoundingClientRect();
        const tooltipHeight = tooltip.offsetHeight;
        const tooltipWidth = tooltip.offsetWidth;

        let top = 0;
        let left = 0;

        // 3. Calculate position based on placement and new dimensions
        switch (step.placement) {
            case 'right':
                left = targetRect.right + 15;
                top = targetRect.top;
                break;
            case 'bottom':
                left = targetRect.left;
                top = targetRect.bottom + 15;
                break;
            case 'top':
                left = targetRect.left;
                top = targetRect.top - tooltipHeight - 15;
                break;
            default: // bottom
                left = targetRect.left;
                top = targetRect.bottom + 15;
        }

        // 4. Boundary checks to keep tooltip on screen
        if (top < 10) top = 10;
        if (left < 10) left = 10;
        if (left + tooltipWidth > window.innerWidth - 10) {
            left = window.innerWidth - tooltipWidth - 10;
        }
        if (top + tooltipHeight > window.innerHeight - 10) {
            top = window.innerHeight - tooltipHeight - 10;
        }
        
        // 5. Apply the final position
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.style.transform = 'none';
    }
    
    // 6. Make the tooltip visible at its final position
    tooltip.style.visibility = 'visible';
}


async function nextTourStep() {
    const tooltip = document.getElementById('tour-tooltip');
    tooltip.style.display = 'none'; // Hide tooltip before performing action

    const step = tourSteps[currentTourStep];

    if (step.shouldClick && !step.isFinal) {
        const targetElement = await waitForElement(step.element);
        if (targetElement) {
            targetElement.click();
        }
    }

    if (currentTourStep < tourSteps.length - 1) {
        currentTourStep++;
        await showTourStep();
    } else {
        await endTour();
    }
}

function prevTourStep() {
    // FIX: Close modals when going backward
    document.getElementById('recipe-detail-modal').style.display = 'none';
    document.getElementById('add-to-plan-modal').style.display = 'none';

    if (currentTourStep > 0) {
        currentTourStep--;
        showTourStep();
    }
}

async function endTour() {
    document.getElementById('tour-overlay').style.display = 'none';
    document.getElementById('tour-tooltip').style.display = 'none';
    document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
    await markTourAsSeen();
}

async function markTourAsSeen() {
    if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userDocRef, { hasSeenOnboardingTour: true });
    }
}
// NEW: Fetch and display community recipes
async function fetchAndDisplayCommunityRecipes() {
    const container = document.getElementById('community-recipes-container');
    container.innerHTML = '<p>Loading community recipes...</p>';

    try {
        const getCommunityRecipes = httpsCallable(functions, 'getCommunityRecipes');
        const result = await getCommunityRecipes({
            cuisine: document.getElementById('cuisine-select').value,
            mealType: document.querySelector('input[name="mealType"]:checked').value
        });
        
        const { todayRecipes, favoriteRecipes } = result.data;

        container.innerHTML = ''; // Clear loader

        // Display Today's Generated Recipes
        if (todayRecipes.length > 0) {
            container.innerHTML += '<h3>Freshly Suggested Today</h3>';
            const todayRow = document.createElement('div');
            todayRow.className = 'recipe-card-row';
            todayRecipes.forEach(recipe => {
                const recipeCard = createRecipeCard(recipe, false);
                todayRow.appendChild(recipeCard);
            });
            container.appendChild(todayRow);
        } else {
            container.innerHTML += '<p>No new recipes suggested by the community today. Be the first!</p>';
        }

        // Display Community Favorites (Premium)
        if (householdData.subscriptionTier === 'paid') {
            if (favoriteRecipes.length > 0) {
                container.innerHTML += '<h3>Top Community Favorites <span class="premium-tag">Premium</span></h3>';
                const favRow = document.createElement('div');
                favRow.className = 'recipe-card-row';
                favoriteRecipes.forEach(recipe => {
                    const recipeCard = createRecipeCard(recipe, true);
                    favRow.appendChild(recipeCard); // Corrected this line
                });
                container.appendChild(favRow); // Corrected this line
            }
        } else {
             container.innerHTML += '<div class="premium-feature disabled" style="margin-top: 2rem;"><h3>Top Community Favorites <span class="premium-tag">Premium</span></h3><p>Upgrade to Premium to see the top-rated recipes saved by the community!</p></div>';
        }

    } catch (error) {
        console.error("Error fetching community recipes:", error);
        container.innerHTML = `<p>Could not load community recipes: ${error.message}</p>`;
    }
}

function startApp() {
    populateCategoryDropdown(document.getElementById('manual-category'));
    populateCategoryDropdown(document.getElementById('grocery-item-category'));

    selectAllGroceryCheckbox = document.getElementById('select-all-grocery-checkbox');
    selectAllPantryCheckbox = document.getElementById('select-all-pantry-checkbox');

    if(selectAllGroceryCheckbox) selectAllGroceryCheckbox.addEventListener('change', handleSelectAllGrocery);
    if(document.getElementById('delete-selected-grocery-btn')) document.getElementById('delete-selected-grocery-btn').addEventListener('click', () => handleBulkDelete(getGroceryListRef(), '.grocery-item input[type="checkbox"]:checked'));
    if(selectAllPantryCheckbox) selectAllPantryCheckbox.addEventListener('change', handleSelectAllPantry);
    if(document.getElementById('delete-selected-pantry-btn')) document.getElementById('delete-selected-pantry-btn').addEventListener('click', () => handleBulkDelete(getPantryRef(), '.pantry-item-checkbox:checked'));

    displayPantryItems();
    updateWeekView();
    displayGroceryList();
    listenToFavorites();
    configurePaywallUI();
    loadUserPreferences();

    // UPDATED: Handle payment status from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('payment_success')) {
        showToast("Upgrade successful! Welcome to Premium.");
        // Clean the URL
        window.history.replaceState({}, document.title, "/");
    } else if (urlParams.has('payment_cancel')) {
        showToast("Payment was canceled. You can upgrade anytime!");
        // Clean the URL
        window.history.replaceState({}, document.title, "/");
    }
}

async function handlePlanMyWeek() {
    const planMyWeekBtn = document.getElementById('plan-my-week-btn');
    if (planMyWeekBtn.classList.contains('disabled')) {
        document.getElementById('upgrade-modal').style.display = 'block';
        return;
    }

    if (!confirm("This will fill in any empty meals for the current week. Are you sure?")) {
        return;
    }

    const originalButtonText = planMyWeekBtn.textContent;
    planMyWeekBtn.disabled = true;

    const mealPlanRef = getMealPlanRef();
    const currentPlanDoc = await getDoc(mealPlanRef);
    const currentMeals = currentPlanDoc.exists() ? currentPlanDoc.data().meals : {};

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayAbbreviations = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const weeklyPlannerCriteria = Array.from(document.querySelectorAll('input[name="plannerCriteria"]:checked')).map(cb => cb.value);
    const planSingleDayFunc = httpsCallable(functions, 'planSingleDay');
    let hasErrors = false;

    let pantryItems = [];
    const usePantryCheckbox = document.getElementById('use-pantry-items-checkbox');
    if (usePantryCheckbox && usePantryCheckbox.checked) {
        const pantryRef = getPantryRef();
        const snapshot = await getDocs(pantryRef);
        pantryItems = snapshot.docs.map(doc => doc.data().name);
    }

    for (let i = 0; i < days.length; i++) {
        const dayAbbr = dayAbbreviations[i];
        const day = days[i];

        const existingMealsForDay = {
            breakfast: !!(currentMeals[dayAbbr] && Object.keys(currentMeals[dayAbbr].breakfast || {}).length > 0),
            lunch: !!(currentMeals[dayAbbr] && Object.keys(currentMeals[dayAbbr].lunch || {}).length > 0),
            dinner: !!(currentMeals[dayAbbr] && Object.keys(currentMeals[dayAbbr].dinner || {}).length > 0),
        };

        if (existingMealsForDay.breakfast && existingMealsForDay.lunch && existingMealsForDay.dinner) {
            continue;
        }

        planMyWeekBtn.textContent = `🤖 Planning ${day}...`;

        try {
            const dailyCuisineSelect = document.querySelector(`.daily-cuisine-select[data-day="${dayAbbr}"]`);
            const dailyCuisine = dailyCuisineSelect ? dailyCuisineSelect.value : '';
            const finalCuisine = dailyCuisine || (householdData ? householdData.cuisine : '');

            const dayCriteria = [...weeklyPlannerCriteria];
            if (finalCuisine && !dayCriteria.includes(finalCuisine)) {
                dayCriteria.push(finalCuisine);
            }

            const result = await planSingleDayFunc({
                day: day,
                criteria: dayCriteria,
                pantryItems: pantryItems,
                existingMeals: existingMealsForDay,
                unitSystem: unitSystem
            });

            const newDayPlan = result.data;
            if (newDayPlan && Object.keys(newDayPlan).length > 0) {
                await setDoc(mealPlanRef, { meals: { [dayAbbr]: newDayPlan } }, { merge: true });
            }

            await delay(1000);

        } catch (error) {
            hasErrors = true;
            console.error(`Error planning ${day}:`, error);
        }
    }

    planMyWeekBtn.textContent = originalButtonText;
    planMyWeekBtn.disabled = false;

    if (hasErrors) {
        showToast("Your week has been planned, but one or more days failed to generate.");
    } else {
        showToast("Your week's empty slots have been filled!");
    }
}

async function renderSidebarCalendar() {
    const containers = [
        document.getElementById('sidebar-calendar-container-desktop'),
        document.getElementById('sidebar-calendar-container-mobile')
    ];

    if (!householdId) return;

    for (const container of containers) {
        if (!container) continue;

        const year = sidebarCalendarDate.getFullYear();
        const month = sidebarCalendarDate.getMonth();

        container.innerHTML = `
            <div class="sidebar-calendar-header">
                 <button class="sidebar-cal-nav-btn" data-cal-nav="prev">&lt;</button>
                 <h5>${sidebarCalendarDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h5>
                 <button class="sidebar-cal-nav-btn" data-cal-nav="next">&gt;</button>
            </div>
            <div class="sidebar-calendar-grid"></div>
        `;

        const grid = container.querySelector('.sidebar-calendar-grid');
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(day => {
            const dayNameEl = document.createElement('div');
            dayNameEl.className = 'sidebar-calendar-day-name';
            dayNameEl.textContent = day;
            grid.appendChild(dayNameEl);
        });

        for (let i = 0; i < firstDay; i++) {
            grid.appendChild(document.createElement('div'));
        }

        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        startOfWeek.setHours(0,0,0,0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        for (let day = 1; day <= daysInMonth; day++) {
            const dayEl = document.createElement('div');
            dayEl.className = 'sidebar-calendar-day';
            dayEl.textContent = day;
            const thisDate = new Date(year, month, day);
            thisDate.setHours(0,0,0,0);

            if (thisDate >= startOfWeek && thisDate <= endOfWeek) {
                dayEl.classList.add('current-week');
            }

            dayEl.addEventListener('click', () => {
                currentDate = thisDate;
                sidebarCalendarDate = new Date(currentDate); // Sync sidebar date on click
                updateWeekView();
                const moreModal = document.getElementById('more-modal');
                if (moreModal) moreModal.style.display = 'none';
            });

            grid.appendChild(dayEl);
        }
    }

    const mealPlanCollectionRef = collection(db, 'households', householdId, 'mealPlan');
    const q = query(mealPlanCollectionRef, where('__name__', '>=', `${sidebarCalendarDate.getFullYear()}-W01`), where('__name__', '<=', `${sidebarCalendarDate.getFullYear()}-W53`));
    const querySnapshot = await getDocs(q);
    const plannedDays = new Set();
    querySnapshot.forEach(doc => {
        const plan = doc.data().meals;
        if (plan) {
            Object.entries(plan).forEach(([dayKey, dayMeals]) => {
                const hasMeals = Object.values(dayMeals).some(mealType => mealType && Object.keys(mealType).length > 0);
                if (hasMeals) {
                    const weekId = doc.id;
                    const [planYear, weekNum] = weekId.split('-W');
                    const janFirst = new Date(planYear, 0, 1);
                    const days = (weekNum - 1) * 7;
                    const date = new Date(janFirst.valueOf() + days * 86400000);
                    const dayIndex = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(dayKey);
                    date.setDate(date.getDate() - date.getDay() + dayIndex);

                    if (date.getMonth() === sidebarCalendarDate.getMonth()) {
                        plannedDays.add(date.getDate());
                    }
                }
            });
        }
    });

    containers.forEach(container => {
        if (container) {
            container.querySelectorAll('.sidebar-calendar-day').forEach(dayEl => {
                dayEl.classList.remove('has-meal');
                const dayNum = parseInt(dayEl.textContent);
                if (plannedDays.has(dayNum)) {
                    dayEl.classList.add('has-meal');
                }
            });
        }
    });
}


// --- How-To Modal Logic ---
function showHowToModal() {
    currentHowToSlide = 0;
    updateHowToSlider();
    document.getElementById('how-to-modal').style.display = 'block';
}

function updateHowToSlider() {
    const howToSlides = document.querySelectorAll('.how-to-slide');
    const howToDotsContainer = document.querySelector('.how-to-dots');
    const howToPrevBtn = document.getElementById('how-to-prev-btn');
    const howToNextBtn = document.getElementById('how-to-next-btn');
    const howToCloseBtn = document.getElementById('how-to-close-btn');

    howToSlides.forEach((slide, index) => {
        slide.classList.toggle('active', index === currentHowToSlide);
    });

    howToDotsContainer.innerHTML = '';
    for (let i = 0; i < howToSlides.length; i++) {
        const dot = document.createElement('div');
        dot.className = 'how-to-dot';
        dot.classList.toggle('active', i === currentHowToSlide);
        howToDotsContainer.appendChild(dot);
    }

    howToPrevBtn.style.display = currentHowToSlide === 0 ? 'none' : 'inline-block';
    howToNextBtn.style.display = currentHowToSlide === howToSlides.length - 1 ? 'none' : 'inline-block';
    howToCloseBtn.style.display = currentHowToSlide === howToSlides.length - 1 ? 'inline-block' : 'none';
}

async function markHowToAsSeen() {
    if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userDocRef, { hasSeenHowToGuide: true });
    }
}

// --- AUTH STATE CHANGE IS NOW HANDLED INSIDE THE getRedirectResult PROMISE ---

// FIX: This function now handles both mobile and desktop sign-in correctly.
function handleGoogleSignIn() {
    const provider = new GoogleAuthProvider();

    signInWithPopup(auth, provider)
        .then((result) => {
            // This will trigger onAuthStateChanged, so no further action is needed here.
            console.log("Signed in with popup successfully.");
        })
        .catch((error) => {
            // Handle errors, specifically popup-blocked errors.
            console.error("Popup sign-in error:", error.code, error.message);
            
            // These error codes indicate that the popup was blocked or is not supported.
            const isPopupError = ['auth/popup-blocked', 'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment'].includes(error.code);

            if (isPopupError) {
                // If the popup fails, fall back to the more reliable redirect method.
                console.log("Popup failed, falling back to redirect.");
                showToast("Popup blocked. Redirecting to sign in page...");
                signInWithRedirect(auth, provider).catch(redirectError => {
                    // This inner catch handles rare errors where the redirect itself cannot be initiated.
                    console.error("Error initiating Google sign-in redirect:", redirectError);
                    showToast(`Could not start the sign-in process: ${redirectError.message}`);
                });
            } else {
                // Handle other errors (e.g., user closed popup, network error)
                showToast(`Login failed: ${error.message}`);
            }
        });
}


async function handleEmailSignIn(e) {
    e.preventDefault();
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const authError = document.getElementById('auth-error');
    authError.style.display = 'none';
    try {
        // This will trigger the onAuthStateChanged listener which will handle verification checks
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        authError.textContent = error.message;
        authError.style.display = 'block';
    }
}

async function handleEmailSignUp(e) {
    e.preventDefault();
    const email = document.getElementById('signup-email-input').value;
    const password = document.getElementById('signup-password-input').value;
    const displayName = document.getElementById('signup-display-name-input').value;
    const authError = document.getElementById('auth-error');
    authError.style.display = 'none';

    // Password validation
    if (password.length < 8) {
        authError.textContent = 'Password must be at least 8 characters long.';
        authError.style.display = 'block';
        return;
    }
    if (!/[A-Z]/.test(password)) {
        authError.textContent = 'Password must contain at least one uppercase letter.';
        authError.style.display = 'block';
        return;
    }
    if (!/[a-z]/.test(password)) {
        authError.textContent = 'Password must contain at least one lowercase letter.';
        authError.style.display = 'block';
        return;
    }
    if (!/[0-9]/.test(password)) {
        authError.textContent = 'Password must contain at least one number.';
        authError.style.display = 'block';
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: displayName });

        // Send verification email
        await sendEmailVerification(userCredential.user);
        
        // Sign the user out until they are verified. This simplifies the logic.
        await signOut(auth);

        // Update the UI to show a confirmation message
        const loginSection = document.getElementById('login-section');
        loginSection.innerHTML = `
            <div class="auth-view">
                <h3><i class="fas fa-envelope-check"></i> Verify Your Email</h3>
                <p>A verification email has been sent to <strong>${email}</strong>. Please check your inbox and click the link to activate your account before signing in.</p>
                <button id="back-to-login-btn" class="link-button">Back to Sign In</button>
            </div>
        `;
        document.getElementById('back-to-login-btn').addEventListener('click', buildLoginForm);
        showToast("Verification email sent!");

    } catch (error) {
        authError.textContent = error.message;
        authError.style.display = 'block';
    }
}

function toggleAuthMode() {
    const emailSigninForm = document.getElementById('email-signin-form');
    const emailSignupForm = document.getElementById('email-signup-form');
    const toggleAuthModeBtn = document.getElementById('toggle-auth-mode');
    const authError = document.getElementById('auth-error');

    const isSignInVisible = emailSigninForm.style.display !== 'none';
    emailSigninForm.style.display = isSignInVisible ? 'none' : 'block';
    emailSignupForm.style.display = isSignInVisible ? 'block' : 'none';
    toggleAuthModeBtn.textContent = isSignInVisible ? 'Have an account? Sign In' : 'Need an account? Sign Up';
    authError.style.display = 'none';
}

async function handleUpgradeClick() {
    try {
        const createStripeCheckout = httpsCallable(functions, 'createStripeCheckout');
        const result = await createStripeCheckout({});
        if (result && result.data && result.data.id) {
            const { id } = result.data;
            await stripe.redirectToCheckout({ sessionId: id });
        } else {
            console.error("Invalid response from createStripeCheckout function:", result);
            throw new Error("The server returned an invalid response.");
        }
    } catch (error) {
        console.error("Error redirecting to Stripe Checkout:", error);
        showToast("Could not initiate payment. Please try again.");
    }
}

async function initializeAppUI(user) {
    currentUser = user;

    const userDocRef = doc(db, 'users', user.uid);
    let userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
        await setDoc(userDocRef, {
            email: user.email,
            householdId: null,
            hasSeenOnboardingTour: false, 
            preferences: {}
        });
        userDoc = await getDoc(userDocRef);
    }

    userPreferences = userDoc.data().preferences || {};
    if (userDoc.data().householdId) {
        householdId = userDoc.data().householdId;
        const householdRef = doc(db, 'households', householdId);

        unsubscribeHousehold();
        unsubscribeHousehold = onSnapshot(householdRef, (householdDoc) => {
            if (householdDoc.exists()) {
                householdData = householdDoc.data();
                document.getElementById('initial-view').style.display = 'none';
                document.getElementById('app-content').style.display = 'block';

                const householdInfoEl = document.getElementById('household-info');
                const householdStatusInfoEl = document.getElementById('household-status-info');

                if(householdInfoEl) {
                    householdInfoEl.innerHTML = `
                        <div class="invite-code-wrapper">
                            <span>Invite Family:</span>
                            <strong id="household-code-text">${householdId}</strong>
                        </div>
                        <button id="copy-household-code-btn" title="Copy Code"><i class="far fa-copy"></i></button>
                    `;
                    householdInfoEl.style.display = 'flex';
                }
                if(householdStatusInfoEl) householdStatusInfoEl.style.display = 'block';

                configurePaywallUI();
            }
        });
        
        // NEW: Load today's suggestions
        const todayString = getTodayDateString();
        const suggestionsRef = doc(db, 'households', householdId, 'dailySuggestions', todayString);
        const suggestionsDoc = await getDoc(suggestionsRef);
        if (suggestionsDoc.exists()) {
            accumulatedRecipes = suggestionsDoc.data().recipes || [];
            displayRecipeResults(accumulatedRecipes, 'ideas');
        } else {
            accumulatedRecipes = [];
        }

        startApp();
        // MODIFIED: Check for new tour flag
        if (!userDoc.data().hasSeenOnboardingTour) {
            startTour();
        }
    } else {
        document.getElementById('initial-view').style.display = 'block';
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('household-manager').style.display = 'block';
        document.getElementById('household-manager').classList.add('active');
        document.getElementById('app-content').style.display = 'none';
    }
}

// --- NEW FUNCTION: handleImportRecipe ---
async function handleImportRecipe(event) {
    event.preventDefault();
    const urlInput = document.getElementById('recipe-url-input');
    const url = urlInput.value.trim();
    if (!url) {
        showToast('Please enter a valid URL.');
        return;
    }

    const recipeResultsDiv = document.getElementById('recipe-results');
    showLoadingState(`Importing recipe...`, recipeResultsDiv, true);
    recipeResultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
        const importRecipeFunc = httpsCallable(functions, 'importRecipeFromUrl');
        const result = await importRecipeFunc({ url: url, unitSystem: unitSystem });

        const { recipe: newRecipe, remaining, isPremium } = result.data;

        if (remaining !== undefined) {
            showToast(`${remaining} ${isPremium ? '' : 'free '}suggestion(s) remaining today.`);
        }

        accumulatedRecipes.unshift(newRecipe);
        if (accumulatedRecipes.length > 18) {
            accumulatedRecipes.length = 18;
        }
        displayRecipeResults(accumulatedRecipes, 'imported');
        urlInput.value = '';

        // Save suggestions to Firestore for persistence
        const todayString = getTodayDateString();
        const suggestionsRef = doc(db, 'households', householdId, 'dailySuggestions', todayString);
        await setDoc(suggestionsRef, { recipes: accumulatedRecipes }, { merge: true });

    } catch (error) {
        console.error("Error importing recipe:", error);
        if (loadingInterval) clearInterval(loadingInterval);
        const existingLoader = document.getElementById('loading-indicator');
        if (existingLoader) existingLoader.remove();
        showToast(`Could not import recipe: ${error.message}`);
    }
}

// --- Admin Functions (for console use) ---
function setAdmin(uid, isAdmin = true) {
    console.log(`Attempting to set admin status for UID: ${uid} to ${isAdmin}`);
    const setAdminStatusFunc = httpsCallable(functions, 'setAdminStatus');
    setAdminStatusFunc({ targetUid: uid, isAdmin: isAdmin })
        .then(result => console.log("Set Admin Status successful:", result.data.message))
        .catch(error => console.error("Error setting admin status:", error));
}
window.setAdmin = setAdmin;

function grantTrial(householdIdToGrant) {
    console.log(`Attempting to grant trial for household: ${householdIdToGrant}`);
    const grantTrialAccessFunc = httpsCallable(functions, 'grantTrialAccess');
    grantTrialAccessFunc({ householdIdToGrant })
        .then(result => console.log("Trial grant successful:", result.data.message))
        .catch(error => console.error("Error granting trial access:", error));
}
window.grantTrial = grantTrial;

// NEW: Function to manually generate a blog post from the console (for admins)
function generateBlogRecipe() {
    if (!currentUser) {
        console.error("You must be logged in to run this function.");
        return;
    }
    console.log("Attempting to generate a new blog recipe...");
    const generateRecipeFunc = httpsCallable(functions, 'generateRecipeForBlog');
    generateRecipeFunc({})
        .then(result => {
            if (result.data.success) {
                console.log("Success:", result.data.message);
                showToast("New blog recipe generated successfully! Refresh the blog page to see it.");
            }
        })
        .catch(error => {
            console.error("Error generating blog recipe:", error);
            showToast(`Error: ${error.message}`);
        });
}
window.generateBlogRecipe = generateBlogRecipe;


// --- MAIN EVENT LISTENER ---
document.addEventListener('DOMContentLoaded', () => {
    // PWA: Register the service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    }
    populateCuisineDropdowns();

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(e.currentTarget.dataset.target);
        });
    });

    document.getElementById('create-household-btn').addEventListener('click', () => {
        document.getElementById('create-household-modal').style.display = 'block';
    });

    document.getElementById('create-household-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const createButton = e.target.querySelector('button[type="submit"]');
        createButton.disabled = true;
        createButton.textContent = 'Creating...';

        try {
            if (!currentUser) {
                throw new Error("You must be signed in to create a household.");
            }
            const householdCuisineSelect = document.getElementById('household-cuisine-select');
            const selectedCuisine = householdCuisineSelect.value;

            if (householdCuisineSelect.required && !selectedCuisine) {
                 showToast("Please select a cuisine preference.");
                 return;
            }

            const newHouseholdId = Math.random().toString(36).substring(2, 8).toUpperCase();
            const householdRef = doc(db, 'households', newHouseholdId);
            const userRef = doc(db, 'users', currentUser.uid);

            const batch = writeBatch(db);
            batch.set(householdRef, {
                owner: currentUser.uid,
                members: [currentUser.uid],
                cuisine: selectedCuisine,
                subscriptionTier: 'free',
                lastCuisineUpdate: serverTimestamp()
            });
            batch.update(userRef, { householdId: newHouseholdId });

            await batch.commit();

            document.getElementById('create-household-modal').style.display = 'none';
            await initializeAppUI(currentUser);

        } catch (error) {
            console.error("Error creating household:", error);
            showToast(`Failed to create household. Please check permissions and try again.`);
        } finally {
            createButton.disabled = false;
            createButton.textContent = 'Create Household';
        }
    });

    // UPDATED: Added loading state to join household button
    document.getElementById('join-household-btn').addEventListener('click', async () => {
        if (!currentUser) return;
        const code = document.getElementById('household-code-input').value.trim().toUpperCase();
        if (!code) {
             showToast("Please enter a household code.");
             return;
        }

        const joinButton = document.getElementById('join-household-btn');
        joinButton.disabled = true;
        joinButton.textContent = 'Joining...';

        try {
            const householdRef = doc(db, 'households', code);
            const householdDoc = await getDoc(householdRef);
            if (!householdDoc.exists()) {
                showToast("Household not found.");
                return;
            }

            const userRef = doc(db, 'users', currentUser.uid);
            const batch = writeBatch(db);
            batch.update(householdRef, { members: arrayUnion(currentUser.uid) });
            batch.update(userRef, { householdId: code });

            await batch.commit();
            await initializeAppUI(currentUser);
        } catch (error) {
            console.error("Error joining household:", error);
            showToast("Failed to join household. Please check the code and try again.");
        } finally {
            joinButton.disabled = false;
            joinButton.textContent = 'Join';
        }
    });

    document.body.addEventListener('click', (event) => {
        const target = event.target;

        // NEW LOGIC: Check for premium feature clicks by free users
        const premiumFeature = target.closest('.premium-feature');
        if (premiumFeature && householdData && householdData.subscriptionTier === 'free') {
            if (premiumFeature.classList.contains('disabled')) {
                event.preventDefault();
                event.stopPropagation();
                document.getElementById('upgrade-modal').style.display = 'block';
                return; 
            }
        }

        if (target.closest('.close-btn')) target.closest('.modal').style.display = 'none';
        if (event.target.classList.contains('modal')) event.target.style.display = 'none';
        if (target.closest('#feedback-btn-sidebar') || target.closest('#feedback-btn-modal')) {
             document.getElementById('more-modal').style.display = 'none';
             document.getElementById('feedback-modal').style.display = 'block';
        }
        if (target.closest('#copy-household-code-btn')) {
            const code = document.getElementById('household-code-text').textContent;
            navigator.clipboard.writeText(code).then(() => showToast('Household code copied!'));
        }
        if (target.closest('#pantry-list')) handlePantryClick(event);
        if (target.closest('#grocery-list')) handleGroceryListClick(event);
        if (target.closest('#recipe-results') || target.closest('#favorite-recipes-container') || target.closest('#community-recipes-container')) handleCardClick(event);
        if (target.closest('#meal-planner-grid')) {
            if (target.closest('.meal-slot')) {
                 handleMealSlotClick(event);
            }
            handlePlanSingleDayClick(event);
        }

        // FIX: Moved calendar navigation to event delegation to prevent duplicate listeners
        if (target.closest('.sidebar-cal-nav-btn')) {
            const direction = target.closest('.sidebar-cal-nav-btn').dataset.calNav;
            if (direction === 'prev') {
                sidebarCalendarDate.setMonth(sidebarCalendarDate.getMonth() - 1);
            } else if (direction === 'next') {
                sidebarCalendarDate.setMonth(sidebarCalendarDate.getMonth() + 1);
            }
            renderSidebarCalendar();
        }

        handleModalClick(event);

        if (target.closest('#update-cuisine-btn')) {
             if (!householdId || target.closest('#update-cuisine-btn').disabled) return;
            const newCuisine = document.getElementById('cuisine-select').value;
            const householdRef = doc(db, 'households', householdId);
            updateDoc(householdRef, {
                cuisine: newCuisine,
                lastCuisineUpdate: serverTimestamp()
            });
            householdData.cuisine = newCuisine;
            householdData.lastCuisineUpdate = { toDate: () => new Date() };
            configurePaywallUI();
            showToast('Cuisine preference updated!');
        }
    });

    document.getElementById('suggest-more-meals-btn')?.addEventListener('click', (e) => {
        const modal = e.target.closest('#select-meal-modal');
        if (modal) {
            const { day, meal } = modal.dataset;
            populateSelectMealModal(day, meal, true);
        }
    });

    document.getElementById('manual-add-form')?.addEventListener('submit', handleManualAdd);
    document.getElementById('add-to-pantry-btn')?.addEventListener('click', addItemsToPantry);
    document.getElementById('item-confirmation-list')?.addEventListener('click', handleRemoveConfirmedItem);
    // NEW: Listener for the grocery confirmation list
    document.getElementById('add-to-grocery-btn')?.addEventListener('click', addItemsToGroceryList);
    document.getElementById('item-confirmation-list-grocery')?.addEventListener('click', handleRemoveConfirmedItem);
    
    document.getElementById('suggest-recipe-btn')?.addEventListener('click', getRecipeSuggestions);
    document.getElementById('discover-recipes-btn')?.addEventListener('click', discoverNewRecipes);
    document.getElementById('start-camera-btn')?.addEventListener('click', startCamera);
    document.getElementById('capture-btn')?.addEventListener('click', captureAndScan);
    document.getElementById('add-grocery-item-form')?.addEventListener('submit', handleAddGroceryItem);
    document.getElementById('move-to-pantry-btn')?.addEventListener('click', showMoveToPantryForm);
    document.getElementById('confirm-move-btn')?.addEventListener('click', handleConfirmMoveToPantry);
    document.getElementById('import-recipe-form')?.addEventListener('submit', handleImportRecipe);


    document.getElementById('show-manual-add-btn').addEventListener('click', () => {
        if (isCameraOpen) stopCamera();
        const container = document.getElementById('pantry-forms-container');
        const manualContainer = document.getElementById('manual-add-container');
        const isVisible = container.style.display === 'block' && manualContainer.style.display === 'block';
        container.style.display = isVisible ? 'none' : 'block';
        manualContainer.style.display = 'block';
        document.getElementById('confirmation-section').style.display = 'none';
        document.getElementById('grocery-forms-container').style.display = 'none';
    });

    document.getElementById('show-add-grocery-form-btn').addEventListener('click', () => {
        if (isCameraOpen) stopCamera();
        const form = document.getElementById('add-grocery-item-form');
        form.style.display = form.style.display === 'none' ? 'flex' : 'none';
        document.getElementById('pantry-forms-container').style.display = 'none';
        document.getElementById('grocery-forms-container').style.display = 'none';
    });

    document.getElementById('show-scan-item-btn').addEventListener('click', () => toggleScanView('pantry'));
    document.getElementById('show-scan-receipt-btn').addEventListener('click', () => toggleScanView('receipt'));
    document.getElementById('show-scan-grocery-btn').addEventListener('click', () => toggleScanView('grocery'));
    document.getElementById('show-scan-receipt-grocery-btn').addEventListener('click', () => toggleScanView('groceryReceipt'));
    document.getElementById('quick-meal-btn').addEventListener('click', () => toggleScanView('quickMeal'));

    document.getElementById('close-scan-btn').addEventListener('click', stopCamera);

    document.getElementById('generate-grocery-list-btn')?.addEventListener('click', generateAutomatedGroceryList);
    document.getElementById('prev-week-btn')?.addEventListener('click', () => navigateWeek('prev'));
    document.getElementById('next-week-btn')?.addEventListener('click', () => navigateWeek('next'));
    
    // TAB SWITCHING LOGIC
    document.getElementById('show-ideas-tab')?.addEventListener('click', (e) => {
        document.getElementById('ideas-content').style.display = 'block';
        document.getElementById('recipe-results').style.display = 'grid';
        document.getElementById('favorite-recipes-container').style.display = 'none';
        document.getElementById('community-recipes-container').style.display = 'none';
        e.target.classList.add('active');
        document.getElementById('show-favorites-tab').classList.remove('active');
        document.getElementById('show-community-tab').classList.remove('active');
    });
    document.getElementById('show-favorites-tab')?.addEventListener('click', (e) => {
        document.getElementById('ideas-content').style.display = 'none';
        document.getElementById('recipe-results').style.display = 'none';
        document.getElementById('favorite-recipes-container').style.display = 'block';
        document.getElementById('community-recipes-container').style.display = 'none';
        e.target.classList.add('active');
        document.getElementById('show-ideas-tab').classList.remove('active');
        document.getElementById('show-community-tab').classList.remove('active');
    });
    document.getElementById('show-community-tab')?.addEventListener('click', (e) => {
        document.getElementById('ideas-content').style.display = 'none';
        document.getElementById('recipe-results').style.display = 'none';
        document.getElementById('favorite-recipes-container').style.display = 'none';
        document.getElementById('community-recipes-container').style.display = 'block';
        e.target.classList.add('active');
        document.getElementById('show-ideas-tab').classList.remove('active');
        document.getElementById('show-favorites-tab').classList.remove('active');
        fetchAndDisplayCommunityRecipes();
    });

    document.getElementById('add-to-plan-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const meal = document.getElementById('meal-select').value;
        if (currentRecipeToPlan && selectedDates.length > 0 && meal) {
            for (const dateString of selectedDates) {
                // FIX: Create date object in UTC to prevent timezone shift issues
                const parts = dateString.split('-'); // "YYYY-MM-DD"
                const dateObject = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
                await addRecipeToPlan(dateObject, meal, currentRecipeToPlan);
            }
            // Also set currentDate using UTC to ensure the view switches to the correct week
            const firstDateParts = selectedDates[0].split('-');
            currentDate = new Date(Date.UTC(firstDateParts[0], firstDateParts[1] - 1, firstDateParts[2], 12, 0, 0));

            document.getElementById('add-to-plan-modal').style.display = 'none';
            currentRecipeToPlan = null;
            selectedDates = [];
            showToast('Recipe added to selected dates!');
            updateWeekView();
        } else {
            showToast('Please select at least one date.');
        }
    });
    document.getElementById('plan-my-week-btn')?.addEventListener('click', handlePlanMyWeek);
    document.getElementById('toggle-all-days-btn')?.addEventListener('click', (e) => {
        const shouldCollapse = e.target.textContent === 'Collapse All';
        document.querySelectorAll('.day-card').forEach(card => {
            card.classList.toggle('collapsed', shouldCollapse);
        });
        e.target.textContent = shouldCollapse ? 'Expand All' : 'Collapse All';
    });
    document.getElementById('calendar-prev-month')?.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() - 1);
        renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
    });
    document.getElementById('calendar-next-month')?.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() + 1);
        renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
    });
    document.getElementById('calendar-grid')?.addEventListener('click', (event) => {
        const dayEl = event.target.closest('.calendar-day');
        if (dayEl && !dayEl.classList.contains('other-month')) {
            const date = dayEl.dataset.date;
            const index = selectedDates.indexOf(date);
            if (index > -1) {
                selectedDates.splice(index, 1);
                dayEl.classList.remove('selected');
            } else {
                selectedDates.push(date);
                dayEl.classList.add('selected');
            }
        }
    });
    document.getElementById('ask-the-chef-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const queryInput = document.getElementById('chef-query-input');
        const mealQuery = queryInput.value.trim();
        if (!mealQuery) {
            showToast('Please enter a meal to ask the chef!');
            return;
        }
        const loadingMessages = [
            `Searching the grand cookbook for "${mealQuery}"...`,
            "Gathering ingredients...",
            "Perfecting the instructions...",
            "Here comes your custom recipe!"
        ];
        showLoadingState(loadingMessages, document.getElementById('recipe-results'), true);
        try {
            const askTheChefFunc = httpsCallable(functions, 'askTheChef');
            const result = await askTheChefFunc({ mealQuery, unitSystem });

            // MODIFIED: Handle new response format
            const { recipe: newRecipe, remaining, isPremium } = result.data;

            if (remaining !== undefined) {
                 showToast(`${remaining} ${isPremium ? '' : 'free '}suggestion(s) remaining today.`);
            }

            accumulatedRecipes.unshift(newRecipe);
            if (accumulatedRecipes.length > 18) {
                accumulatedRecipes.length = 18;
            }
            displayRecipeResults(accumulatedRecipes, 'your custom');
            queryInput.value = '';

            // NEW: Save suggestions to Firestore for persistence
            const todayString = getTodayDateString();
            const suggestionsRef = doc(db, 'households', householdId, 'dailySuggestions', todayString);
            await setDoc(suggestionsRef, { recipes: accumulatedRecipes }, { merge: true });
            
        } catch (error) {
            if (loadingInterval) clearInterval(loadingInterval);
            console.error("Error asking the chef:", error);
            document.getElementById('recipe-results').innerHTML = `<p>Sorry, the chef couldn't find a recipe for that: ${error.message}</p>`;
        }
    });
    document.getElementById('toggle-all-pantry-btn')?.addEventListener('click', (e) => handleToggleAll(document.getElementById('pantry-list'), e.target));
    document.getElementById('toggle-all-grocery-btn')?.addEventListener('click', (e) => handleToggleAll(document.getElementById('grocery-list'), e.target));
    document.querySelectorAll('.collapsible-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            header.classList.toggle('active');
            if (content.style.maxHeight) {
                content.style.maxHeight = null;
            } else {
                content.style.maxHeight = content.scrollHeight + "px";
            }
        });
    });
    document.getElementById('how-to-next-btn')?.addEventListener('click', () => {
        const howToSlides = document.querySelectorAll('.how-to-slide');
        if (currentHowToSlide < howToSlides.length - 1) {
            currentHowToSlide++;
            updateHowToSlider();
        }
    });
    document.getElementById('how-to-prev-btn')?.addEventListener('click', () => {
        if (currentHowToSlide > 0) {
            currentHowToSlide--;
            updateHowToSlider();
        }
    });
    document.getElementById('how-to-close-btn')?.addEventListener('click', () => {
        document.getElementById('how-to-modal').style.display = 'none';
        markHowToAsSeen();
    });
    document.getElementById('feedback-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textarea = document.getElementById('feedback-textarea');
        const feedbackText = textarea.value.trim();
        if (feedbackText) {
            try {
                await addDoc(collection(db, 'feedback'), {
                    text: feedbackText,
                    userId: currentUser ? currentUser.uid : 'anonymous',
                    email: currentUser ? currentUser.email : 'anonymous',
                    submittedAt: serverTimestamp()
                });
                textarea.value = '';
                document.getElementById('feedback-modal').style.display = 'none';
                showToast('Thank you for your feedback!');
            } catch (error) {
                console.error("Error submitting feedback:", error);
                showToast('Sorry, there was an issue submitting your feedback. (Check Permissions)');
            }
        }
    });
    document.getElementById('sync-calendar-btn')?.addEventListener('click', () => {
        const syncCalendarBtn = document.getElementById('sync-calendar-btn');
        if (syncCalendarBtn.classList.contains('disabled')) {
            document.getElementById('upgrade-modal').style.display = 'block';
            return;
        }
        if (householdId) {
            const functionUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/calendarFeed?householdId=${householdId}`;
            document.getElementById('calendar-url-input').value = functionUrl;
            document.getElementById('sync-calendar-modal').style.display = 'block';
        } else {
            showToast('Could not generate calendar link. Household not found.');
        }
    });

    document.getElementById('copy-calendar-url-btn')?.addEventListener('click', () => {
        const urlInput = document.getElementById('calendar-url-input');
        if (urlInput.value) {
            navigator.clipboard.writeText(urlInput.value)
                .then(() => showToast('Calendar URL copied to clipboard!'))
                .catch(err => {
                    console.error('Failed to copy text: ', err);
                    showToast('Failed to copy URL.');
                });
        }
    });

    document.getElementById('more-nav-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('more-modal').style.display = 'block';
    });

    document.querySelectorAll('input[name="plannerCriteria"], input[name="recipeCriteria"], input[name="unitSystem"]').forEach(element => {
        element.addEventListener('change', handlePreferenceChange);
    });

    // NEW: Upgrade Modal Listener
    document.getElementById('modal-upgrade-btn')?.addEventListener('click', handleUpgradeClick);

    // NEW: Event listener for the tabs in the select meal modal
    document.querySelector('#select-meal-modal .modal-tabs')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-link')) {
            const modal = e.target.closest('.modal-content');
            modal.querySelectorAll('.tab-link').forEach(tab => tab.classList.remove('active'));
            modal.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            e.target.classList.add('active');
            const tabContentId = e.target.dataset.tab;
            document.getElementById(tabContentId)?.classList.add('active');
        }
    });
});