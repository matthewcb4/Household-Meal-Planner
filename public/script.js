// Import all necessary functions from the Firebase SDKs at the top
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, getDocs, onSnapshot, query, where, writeBatch, arrayUnion, serverTimestamp, deleteDoc, orderBy, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCylczs2HKlIKQTiikGFFnF9cB60jEXLUo",
  authDomain: "family-dinner-app-dev.firebaseapp.com",
  projectId: "family-dinner-app-dev",
  storageBucket: "family-dinner-app-dev.firebasestorage.app",
  messagingSenderId: "1065607981746",
  appId: "1:1065607981746:web:99124a92a45287bc35b7ab",
  measurementId: "G-XPPVQ8S73W"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app);
const stripe = Stripe('pk_live_51RwOcyPk8em715yUgWedIOa1K2lPO5GLVcRulsJwqQQvGSna5neExF97cikgW7PCdIjlE4zugr5DasBqAE0CTPaV00Pg771UkD');


// --- GLOBAL VARIABLES ---
let currentUser = null, householdId = null, stream = null, scanMode = 'pantry', currentDate = new Date(), unsubscribeHousehold = () => {}, unsubscribeMealPlan = () => {}, unsubscribeFavorites = () => {}, selectAllGroceryCheckbox = null, selectAllPantryCheckbox = null, currentRecipeToPlan = null, householdData = null, userPreferences = {};
let unitSystem = 'imperial';
let calendarDate = new Date();
let selectedDates = [];
let currentHowToSlide = 0;

const PANTRY_CATEGORIES = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"];
const CUISINE_OPTIONS = ["American", "Asian", "French", "Greek", "Indian", "Italian", "Mediterranean", "Mexican", "Spanish", "Thai"];

// --- NEW: Function to create and manage the auth UI in the top bar ---
function renderAuthUI(user) {
    const authContainer = document.getElementById('auth-container');
    authContainer.innerHTML = ''; // Clear previous state
    if (user) {
        const userProfile = document.createElement('div');
        userProfile.className = 'user-profile';
        userProfile.innerHTML = `
            <span id="welcome-message">Hello, ${user.displayName || user.email}!</span>
            <div id="household-details">
                <p id="household-info" class="household-code-container" style="display: none;"></p>
                <p id="household-status-info" style="display: none;"></p>
            </div>
            <button id="upgrade-btn-header" class="upgrade-button" style="display: none;">Upgrade</button>
            <button id="sign-out-btn" class="danger">Sign Out</button>
        `;
        authContainer.appendChild(userProfile);
        document.getElementById('sign-out-btn').addEventListener('click', () => signOut(auth));
        const upgradeBtn = document.getElementById('upgrade-btn-header');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', handleUpgradeClick);
        }
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
    }
}

// --- NEW: Function to build the login form when needed ---
function buildLoginForm() {
    const loginSection = document.getElementById('login-section');
    loginSection.innerHTML = `
        <div class="auth-view">
            <h3>Welcome to the Meal Planner</h3>
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
function showLoadingState(message, container) {
    if (!container) return;
    container.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><p>${message}</p></div>`;
}

// --- UI DISPLAY FUNCTIONS ---
async function displayPantryItems() {
    const pantryListDiv = document.getElementById('pantry-list');
    const pantryBulkControls = document.getElementById('pantry-bulk-controls');
    const pantryRef = getPantryRef();
    if (!pantryRef) return;
    pantryListDiv.innerHTML = '<li>Loading pantry...</li>';
    const snapshot = await getDocs(pantryRef);
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
            categoryHeader.innerHTML = `${category}<span class="category-toggle">+</span>`;
            pantryListDiv.appendChild(categoryHeader);
            const list = document.createElement('ul');
            list.style.display = 'none';
            groupedItems[category].sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
                const listItem = document.createElement('li');
                listItem.className = 'pantry-item';
                listItem.innerHTML = `
                    <div class="item-info">
                         <input type="checkbox" class="pantry-item-checkbox" data-id="${item.id}">
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
    const snapshot = await getDocs(q);

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
            categoryHeader.innerHTML = `${category}<span class="category-toggle">+</span>`;
            groceryList.appendChild(categoryHeader);

            const list = document.createElement('ul');
            list.style.display = 'none';

            groupedItems[category].sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
                const listItem = document.createElement('li');
                listItem.className = `grocery-item ${item.checked ? 'checked' : ''}`;
                listItem.innerHTML = `
                    <div class="item-info">
                        <input type="checkbox" data-id="${item.id}" ${item.checked ? 'checked' : ''}>
                        <label>${item.name}</label>
                    </div>
                    <div class="grocery-item-controls">
                        <a href="https://www.walmart.com/search?q=${encodeURIComponent(item.name)}" target="_blank" class="walmart-search-btn" title="Search on Walmart"><span>W</span></a>
                        <button class="delete-grocery-btn" data-id="${item.id}">X</button>
                    </div>
                `;
                list.appendChild(listItem);
            });
            groceryList.appendChild(list);
        }
    });
    handleGroceryItemCheck();
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

    days.forEach((day, index) => {
        const dayCard = document.createElement('div');
        dayCard.className = 'day-card';

        if (isCurrentWeek && index === currentDayIndex) {
            dayCard.classList.add('today');
        }
        
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.innerHTML = `
            <span>${day}</span>
            <button class="plan-day-btn secondary" data-day="${day.toLowerCase()}" data-day-full-name="${fullDayNames[index]}">✨</button>
        `;
        
        // Add click listener for collapsing
        dayHeader.addEventListener('click', (e) => {
            // Don't collapse if the plan button itself was clicked
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
        renderSidebarCalendar(); // Re-render calendar to update meal indicators
    });
}

async function addRecipeToPlan(dateObject, meal, recipe) {
    const dayAbbr = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dateObject.getDay()];
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
    const header = event.target.closest('.category-header');
    if (header) {
        const list = header.nextElementSibling;
        const toggle = header.querySelector('.category-toggle');
        if (list && (list.tagName === 'UL' || list.classList.contains('favorite-recipe-grid') || list.classList.contains('recipe-card-row'))) {
            const isVisible = list.style.display !== 'none';
            list.style.display = isVisible ? 'none' : 'block';
            if (toggle) toggle.textContent = isVisible ? '−' : '+';
        }
    }

    if (event.target.classList.contains('delete-pantry-item-btn')) {
        const itemId = event.target.dataset.id;
        if (confirm("Are you sure you want to remove this item from your pantry?")) {
            deleteDoc(doc(getPantryRef(), itemId)).then(() => displayPantryItems());
        }
    }

    if (event.target.classList.contains('pantry-item-checkbox')) {
        handlePantryItemCheck();
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
            await addDoc(pantryRef, { name, quantity, unit, category, addedBy: currentUser.email });
        }

        displayPantryItems();
        document.getElementById('manual-add-form').reset();
        document.getElementById('add-item-container').style.display = 'none';
    }
}

async function addItemsToPantry() {
    const itemConfirmationList = document.getElementById('item-confirmation-list');
    const pantryRef = getPantryRef();
    if (!pantryRef) {
        alert("Error: Not in a household. Cannot add items to pantry.");
        return;
    }
    const confirmedItems = itemConfirmationList.querySelectorAll('.confirmation-item');
    if (confirmedItems.length === 0) {
        alert("No items to add!");
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
                batch.set(newItemRef, { name, quantity, unit, category, addedBy: currentUser.email, createdAt: serverTimestamp() });
            }
        }
    });
    await batch.commit();
    displayPantryItems();
    document.getElementById('confirmation-section').style.display = 'none';
    document.getElementById('add-item-container').style.display = 'none';
}

// --- RECIPE FUNCTIONS (FIXED) ---
function createRecipeCard(recipe, isFavorite) {
    const recipeCard = document.createElement('div');
    recipeCard.className = 'recipe-card';
    recipeCard.draggable = true;
    recipeCard.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/json', JSON.stringify(recipe));
        e.dataTransfer.effectAllowed = 'copy';
    });

    const imageUrl = recipe.imageUrl || `https://placehold.co/600x400/333/FFF?text=${encodeURIComponent(recipe.imageQuery || recipe.title)}`;

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

    const googleSearchQuery = encodeURIComponent(`${recipe.title} recipe`);
    const googleSearchUrl = `https://www.google.com/search?q=${googleSearchQuery}`;
    
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
                 <button class="instructions-toggle secondary" disabled>Show Instructions</button>
                 <div class="premium-overlay">
                     <span class="premium-tag">Premium</span>
                 </div>
            </div>
        `;
    }

    const cardActionsHTML = `<div class="card-actions"><button class="add-to-plan-btn">Add to Plan</button>${instructionsHTML}</div>`;
    let ratingHTML = '';
    if (isFavorite) {
        ratingHTML = '<div class="star-rating">';
        for (let i = 1; i <= 5; i++) {
            ratingHTML += `<span class="star ${i <= (recipe.rating || 0) ? 'filled' : ''}" data-rating="${i}" data-id="${recipe.id}">★</span>`;
        }
        ratingHTML += '</div>';
    }

    const cardContent = `
        <div class="recipe-card-header">
            <h3><a href="${googleSearchUrl}" target="_blank" title="Search for this recipe">${recipe.title} 🔗</a></h3>
        </div>
        ${ratingHTML}
        <p>${recipe.description}</p>
        ${cardActionsHTML}
        ${ingredientsHTML}
    `;

    recipeCard.innerHTML = `
        <img src="${imageUrl}" alt="${recipe.title}" class="recipe-image" onerror="this.onerror=null;this.src='https://placehold.co/600x400/333/FFF?text=Image+Not+Found';">
        <button class="save-recipe-btn ${isFavorite ? 'is-favorite' : ''}" title="${isFavorite ? 'Remove from Favorites' : 'Save to Favorites'}">⭐</button>
        <div class="recipe-card-content">${cardContent}</div>
    `;
    
    recipeCard.dataset.recipe = JSON.stringify(recipe);
    return recipeCard;
}

function displayRecipeResults(recipes, mealType) {
    const recipeResultsDiv = document.getElementById('recipe-results');
    recipeResultsDiv.innerHTML = "";
    if (!recipes || recipes.length === 0) {
        recipeResultsDiv.innerHTML = `<p>The AI couldn't think of any ${mealType} recipes with the selected criteria.</p>`;
        return;
    }
    recipes.forEach(async (recipe) => {
        const favoritesRef = getFavoritesRef();
        const q = query(favoritesRef, where("title", "==", recipe.title));
        const querySnapshot = await getDocs(q);
        const isFavorite = !querySnapshot.empty;
        if(isFavorite) {
            recipe.id = querySnapshot.docs[0].id;
        }
        if (!recipe.mealType) {
            recipe.mealType = mealType;
        }
        const recipeCard = createRecipeCard(recipe, isFavorite);
        if (recipes.length === 1) {
            recipeCard.classList.add('expanded');
        }
        recipeResultsDiv.appendChild(recipeCard);
    });
}

async function getRecipeSuggestions() {
    const pantryRef = getPantryRef();
    if (!pantryRef) {
        document.getElementById('recipe-results').innerHTML = "<p>Error: Not in a household.</p>";
        return;
    }
    const snapshot = await getDocs(pantryRef);
    const pantryItems = snapshot.docs.map(doc => doc.data().name);
    if (pantryItems.length === 0) {
        document.getElementById('recipe-results').innerHTML = "<p>Your pantry is empty. Add some items to get suggestions.</p>";
        return;
    }
    await generateRecipes(pantryItems, 'Suggest from Pantry');
}

async function discoverNewRecipes() {
    await generateRecipes(null, 'Discover New Recipes');
}

async function generateRecipes(items, source) {
    const recipeResultsDiv = document.getElementById('recipe-results');
    const selectedMealType = document.querySelector('input[name="mealType"]:checked').value;
    const selectedCuisine = document.getElementById('cuisine-select').value;
    const selectedCriteria = Array.from(document.querySelectorAll('input[name="recipeCriteria"]:checked')).map(cb => cb.value);

    let loadingMessage = `Your Chef is creating ${selectedCuisine} ${selectedMealType} recipes...`;
    showLoadingState(loadingMessage, recipeResultsDiv);

    try {
        let result;
        const commonPayload = {
            mealType: selectedMealType,
            cuisine: selectedCuisine,
            criteria: selectedCriteria,
            unitSystem: unitSystem 
        };

        if (source === 'Suggest from Pantry') {
            const suggestRecipesFunc = httpsCallable(functions, 'suggestRecipes');
            result = await suggestRecipesFunc({ ...commonPayload, pantryItems: items });
        } else {
            const discoverRecipesFunc = httpsCallable(functions, 'discoverRecipes');
            result = await discoverRecipesFunc(commonPayload);
        }
        displayRecipeResults(result.data, selectedMealType);
    } catch (error) {
        console.error("Error getting recipes:", error);
        recipeResultsDiv.innerHTML = "<p>Sorry, couldn't get recipe suggestions at this time.</p>";
    }
}

async function captureAndScan() {
    const canvasElement = document.getElementById('capture-canvas');
    const videoElement = document.getElementById('camera-stream');
    const capturedImageElement = document.getElementById('captured-image');
    const itemConfirmationList = document.getElementById('item-confirmation-list');
    const confirmationSection = document.getElementById('confirmation-section');
    const recipeResultsDiv = document.getElementById('recipe-results');
    const groceryScanUIPlaceholder = document.getElementById('grocery-scan-ui-placeholder');

    const context = canvasElement.getContext('2d');
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
    context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    const base64ImageData = canvasElement.toDataURL('image/jpeg').split(',')[1];
    capturedImageElement.src = `data:image/jpeg;base64,${base64ImageData}`;
    capturedImageElement.style.display = 'block';
    stopCamera();
    
    let targetContainer;
    let scanFunction;

    switch (scanMode) {
        case 'quickMeal':
            targetContainer = recipeResultsDiv;
            showLoadingState('Scanning ingredients and finding recipes...', targetContainer);
            scanFunction = httpsCallable(functions, 'identifyItems');
            break;
        case 'receipt': // For Pantry
            targetContainer = itemConfirmationList;
            confirmationSection.style.display = 'block';
            targetContainer.innerHTML = '<p>🧠 Reading receipt for Pantry...</p>';
            scanFunction = httpsCallable(functions, 'scanReceipt');
            break;
        case 'groceryReceipt': // For Grocery List
            targetContainer = groceryScanUIPlaceholder;
            showLoadingState("Reading receipt for Grocery List...", targetContainer);
            scanFunction = httpsCallable(functions, 'scanReceipt');
            break;
        case 'grocery': // For Grocery List (single items)
             targetContainer = groceryScanUIPlaceholder;
             showLoadingState("Scanning items for Grocery List...", targetContainer);
             scanFunction = httpsCallable(functions, 'identifyItems');
             break;
        case 'pantry':
        default:
            targetContainer = itemConfirmationList;
            confirmationSection.style.display = 'block';
            targetContainer.innerHTML = '<p>🧠 Identifying items...</p>';
            scanFunction = httpsCallable(functions, 'identifyItems');
            break;
    }

    try {
        const result = await scanFunction({ image: base64ImageData });
        const identifiedItems = result.data;

        if (scanMode === 'quickMeal') {
            const itemNames = identifiedItems.map(item => item.name);
            await generateRecipes(itemNames, 'Suggest from Pantry');
        } else if (scanMode === 'pantry' || scanMode === 'receipt') {
            displayConfirmationForm(identifiedItems);
        } else if (scanMode === 'grocery' || scanMode === 'groceryReceipt') {
            const groceryRef = getGroceryListRef();
            if (!groceryRef || !identifiedItems || identifiedItems.length === 0) {
                 targetContainer.innerHTML = '<p>No items found to add.</p>';
                 setTimeout(() => { targetContainer.innerHTML = '' }, 3000);
                 return;
            }
            const batch = writeBatch(db);
            identifiedItems.forEach(item => {
                const newItemRef = doc(groceryRef);
                batch.set(newItemRef, { name: item.name.toLowerCase(), category: item.category || 'Other', checked: false, createdAt: serverTimestamp() });
            });
            await batch.commit();
            displayGroceryList();
            targetContainer.innerHTML = '';
        }

    } catch (error) {
        console.error('Error calling scan function:', error);
        targetContainer.innerHTML = `<p>Sorry, the AI scan failed. Please try again.</p>`;
    } finally {
        scanItemContainer.style.display = 'none'; // Hide the scan modal after processing
        scanMode = 'pantry'; // Reset to default
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
    } catch (err) { console.error("Error accessing camera: ", err); }
}

function stopCamera() {
    const videoElement = document.getElementById('camera-stream');
    const cameraContainer = document.getElementById('camera-container');
    const startCameraBtn = document.getElementById('start-camera-btn');
    const captureBtn = document.getElementById('capture-btn');

    if (stream) { stream.getTracks().forEach(track => track.stop()); }
    videoElement.srcObject = null;
    cameraContainer.style.display = 'none';
    startCameraBtn.style.display = 'block';
    captureBtn.style.display = 'none';
}

async function handleAddGroceryItem(event) {
    event.preventDefault();
    const groceryRef = getGroceryListRef();
    if (!groceryRef) return;
    const itemNameInput = document.getElementById('grocery-item-name');
    const groceryItemCategorySelect = document.getElementById('grocery-item-category');
    const name = itemNameInput.value.trim();
    const category = groceryItemCategorySelect.value;
    if (name) {
        await addDoc(groceryRef, {
            name: name,
            category: category,
            checked: false,
            createdAt: serverTimestamp()
        });
        itemNameInput.value = '';
        displayGroceryList();
    }
}

async function handleGroceryListClick(event) {
    const groceryRef = getGroceryListRef();
    if (!groceryRef) return;

    const header = event.target.closest('.category-header');
    if (header) {
        const list = header.nextElementSibling;
        const toggle = header.querySelector('.category-toggle');
        if (list && list.tagName === 'UL') {
            const isVisible = list.style.display !== 'none';
            list.style.display = isVisible ? 'none' : 'block';
            if(toggle) toggle.textContent = isVisible ? '+' : '−';
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
        handleGroceryItemCheck();
    }

    if (event.target.classList.contains('delete-grocery-btn')) {
        const itemId = event.target.dataset.id;
        if (itemId) {
            if (confirm("Are you sure you want to remove this item from your grocery list?")) {
                await deleteDoc(doc(groceryRef, itemId));
                displayGroceryList();
            }
        }
    }
}


async function moveSelectedItemsToPantryDirectly() {
    const groceryList = document.getElementById('grocery-list');
    const checkedItems = groceryList.querySelectorAll('input[type="checkbox"]:checked');
    if (checkedItems.length === 0) {
        alert("Please select items to move.");
        return;
    }

    if (!confirm(`Move ${checkedItems.length} item(s) to your pantry? They will be removed from this list.`)) {
        return;
    }

    const pantryRef = getPantryRef();
    const groceryRef = getGroceryListRef();
    if (!pantryRef || !groceryRef) return;

    try {
        const batch = writeBatch(db);

        const pantrySnapshot = await getDocs(pantryRef);
        const existingPantryItems = {};
        pantrySnapshot.forEach(pantryDoc => {
            const data = pantryDoc.data();
            existingPantryItems[data.name.toLowerCase()] = { id: pantryDoc.id, ...data };
        });

        const itemIdsToMove = Array.from(checkedItems).map(cb => cb.dataset.id);
        const itemDocsPromises = itemIdsToMove.map(id => getDoc(doc(groceryRef, id)));
        const groceryItemSnapshots = await Promise.all(itemDocsPromises);

        groceryItemSnapshots.forEach(groceryItemDoc => {
            if (groceryItemDoc.exists()) {
                const item = groceryItemDoc.data();
                const name = item.name.toLowerCase();
                const quantity = 1; 
                const unit = 'units';
                const category = item.category || 'Other';

                if (existingPantryItems[name]) {
                    const existingItem = existingPantryItems[name];
                    const newQuantity = (existingItem.quantity || 0) + quantity;
                    const itemRef = doc(pantryRef, existingItem.id);
                    batch.update(itemRef, { quantity: newQuantity });
                } else {
                    const newItemRef = doc(pantryRef);
                    batch.set(newItemRef, { name, quantity, unit, category, addedBy: currentUser.email, createdAt: serverTimestamp() });
                }
                batch.delete(groceryItemDoc.ref);
            }
        });

        await batch.commit();
        displayPantryItems();
        displayGroceryList();
    } catch (error) {
        console.error("Error moving items to pantry:", error);
        alert("There was an error moving items to the pantry.");
    }
}

async function handleAddFromRecipe(buttonElement) { 
    if (!householdId) { 
        alert("Error: Household not found. Please sign in again."); 
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
        displayGroceryList();
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

async function handleCardClick(event) {
    const target = event.target;
    const card = target.closest('.recipe-card');
    if (!card) return;

    const addToListBtn = target.closest('.add-to-list-btn');

    if (target.closest('.save-recipe-btn')) {
        const recipeData = JSON.parse(card.dataset.recipe);
        toggleFavorite(recipeData, target.closest('.save-recipe-btn'));
    } else if (addToListBtn) {
        handleAddFromRecipe(addToListBtn);
    } else if (target.closest('.add-to-plan-btn')) {
        currentRecipeToPlan = JSON.parse(card.dataset.recipe);
        document.getElementById('add-to-plan-recipe-title').textContent = currentRecipeToPlan.title;
        selectedDates = []; 
        calendarDate = new Date(); 
        renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
        document.getElementById('add-to-plan-modal').style.display = 'block';
    } else if (target.closest('.instructions-toggle') || target.closest('.ingredients-toggle')) {
        const button = target.closest('button');
        const list = button.nextElementSibling;
        if (list) {
            const isVisible = list.style.display === 'block';
            list.style.display = isVisible ? 'none' : 'block';
            button.textContent = isVisible ? button.textContent.replace('Hide', 'Show') : button.textContent.replace('Show', 'Hide');
        }
    } else if (target.closest('.star')) {
        const recipeId = target.closest('.star-rating').querySelector('.star').dataset.id;
        const newRating = parseInt(target.dataset.rating, 10);
        const favoritesRef = getFavoritesRef();
        if (favoritesRef && recipeId) {
            await updateDoc(doc(favoritesRef, recipeId), { rating: newRating });
        }
    }
}

async function handleMealSlotClick(event) {
    const slot = event.target.closest('.meal-slot');
    if (!slot) return;

    const day = slot.dataset.day;
    const meal = slot.dataset.meal;
    const mealPlanRef = getMealPlanRef();
    const docSnap = await getDoc(mealPlanRef);
    
    const modalRecipeList = document.getElementById('modal-recipe-list');
    const modalSlotTitle = document.getElementById('modal-slot-title');
    const mealPlanModal = document.getElementById('meal-plan-modal');

    modalRecipeList.innerHTML = '';
    modalSlotTitle.textContent = `${day.charAt(0).toUpperCase() + day.slice(1)} ${meal.charAt(0).toUpperCase() + meal.slice(1)}`;

    if (docSnap.exists()) {
        const plan = docSnap.data();
        const mealsForSlot = plan.meals?.[day]?.[meal];
        if (mealsForSlot) {
            Object.entries(mealsForSlot).forEach(([mealEntryId, recipe]) => {
                const recipeCard = document.createElement('div');
                recipeCard.className = 'recipe-card modal-recipe-item';
                recipeCard.dataset.recipe = JSON.stringify(recipe);
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

                recipeCard.innerHTML = `
                    <button class="remove-from-plan-btn" data-day="${day}" data-meal="${meal}" data-id="${mealEntryId}">X</button>
                    <img src="${imageUrl}" alt="${recipe.title}" class="recipe-image" onerror="this.onerror=null;this.src='https://placehold.co/600x400/EEE/31343C?text=Image+Not+Found';">
                    <h3><a href="${googleSearchUrl}" target="_blank">${recipe.title} 🔗</a></h3>
                    <div class="modal-card-actions">
                        <button class="favorite-from-modal-btn secondary">Favorite ⭐</button>
                        <button class="add-to-plan-btn secondary">Add to Plan Again</button>
                    </div>
                    ${ratingHTML}
                    <p>${recipe.description}</p>
                    ${instructionsHTML}
                    <strong>Ingredients:</strong>
                    ${ingredientsHTML}
                `;
                modalRecipeList.appendChild(recipeCard);
            });
        }
    }
    mealPlanModal.style.display = 'block';
}

async function handleModalClick(event) {
    const target = event.target;
    const card = target.closest('.modal-recipe-item');
    if (!card) return;

    if (target.classList.contains('instructions-toggle')) {
        const list = target.nextElementSibling;
        const isVisible = list.style.display === 'block';
        list.style.display = isVisible ? 'none' : 'block';
        target.textContent = isVisible ? 'Show Instructions' : 'Hide Instructions';
    } else if (target.classList.contains('remove-from-plan-btn')) {
        const { day, meal, id } = target.dataset;
        const mealPlanRef = getMealPlanRef();
        const updatePath = `meals.${day}.${meal}.${id}`;
        await updateDoc(mealPlanRef, { [updatePath]: deleteField() });
        document.getElementById('meal-plan-modal').style.display = 'none';
    } else if (target.classList.contains('favorite-from-modal-btn')) {
        const recipeData = JSON.parse(card.dataset.recipe);
        await toggleFavorite(recipeData);
    } else if (target.classList.contains('add-to-plan-btn')) {
        currentRecipeToPlan = JSON.parse(card.dataset.recipe);
        document.getElementById('add-to-plan-recipe-title').textContent = currentRecipeToPlan.title;
        selectedDates = [];
        calendarDate = new Date();
        renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
        document.getElementById('meal-plan-modal').style.display = 'none';
        document.getElementById('add-to-plan-modal').style.display = 'block';
    }
     else if (target.classList.contains('star')) {
        const { rating, day, meal, id } = target.dataset;
        const mealPlanRef = getMealPlanRef();
        const updatePath = `meals.${day}.${meal}.${id}.rating`;
        await updateDoc(mealPlanRef, { [updatePath]: parseInt(rating, 10) });
        
        const starContainer = target.parentElement;
        const stars = starContainer.querySelectorAll('.star');
        stars.forEach(star => {
            star.classList.toggle('filled', parseInt(star.dataset.rating, 10) <= parseInt(rating, 10));
        });
    }
}

async function handleBulkDelete(collectionRef, checkedItemsSelector) {
    const checkedItems = document.querySelectorAll(checkedItemsSelector);
    if (checkedItems.length === 0) {
        alert("Please select items to delete.");
        return;
    }
    if (confirm(`Are you sure you want to delete ${checkedItems.length} item(s)?`)) {
        const batch = writeBatch(db);
        checkedItems.forEach(checkbox => {
            batch.delete(doc(collectionRef, checkbox.dataset.id));
        });
        await batch.commit();
        if (collectionRef.path.includes('pantryItems')) {
            displayPantryItems();
        } else {
            displayGroceryList();
        }
    }
}

function handleToggleAll(listElement, buttonElement) {
    const allLists = listElement.querySelectorAll('ul');
    if (allLists.length === 0) return;

    const shouldExpand = allLists[0].style.display === 'none';

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

function openCameraFor(mode, placeholderElement) {
    const scanItemContainer = document.getElementById('scan-item-container');
    scanMode = mode;
    placeholderElement.appendChild(scanItemContainer);
    scanItemContainer.style.display = 'flex'; // Use flex for centering
    document.getElementById('captured-image').style.display = 'none';
    document.getElementById('captured-image').src = '';
    document.getElementById('item-confirmation-list').innerHTML = '';
    document.getElementById('confirmation-section').style.display = 'none';
    startCamera();
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
            displayGroceryList();
        } else {
            throw new Error(result.data.error || "Unknown error");
        }
    } catch (error) {
        console.error("Error generating grocery list:", error);
        showToast(`Could not generate grocery list: ${error.message}`);
    }
}

function grantTrial(householdIdToGrant) {
    console.log(`Attempting to grant trial for household: ${householdIdToGrant}`);
    const grantTrialAccessFunc = httpsCallable(functions, 'grantTrialAccess');
    grantTrialAccessFunc({ householdIdToGrant })
        .then(result => console.log("Trial grant successful:", result.data.message))
        .catch(error => console.error("Error granting trial access:", error));
}
window.grantTrial = grantTrial;

function configurePaywallUI() {
    if (!householdData) return;
    const premiumFeatures = document.querySelectorAll('.premium-feature');
    const upgradeBtnHeader = document.getElementById('upgrade-btn-header');
    const householdStatusInfo = document.getElementById('household-status-info');
    const updateCuisineBtn = document.getElementById('update-cuisine-btn');
    const cuisineSelect = document.getElementById('cuisine-select');
    
    let statusText = `Status: ${householdData.subscriptionTier.charAt(0).toUpperCase() + householdData.subscriptionTier.slice(1)}`;

    if (householdData.subscriptionTier === 'free') {
        const scansUsed = householdData.scanUsage?.count || 0;
        const scansLeft = 20 - scansUsed;
        statusText += ` (${scansLeft} / 20 Scans Left)`;
        if (upgradeBtnHeader) upgradeBtnHeader.style.display = 'block';
        premiumFeatures.forEach(el => {
            el.classList.add('disabled');
            el.querySelectorAll('input, button, select').forEach(input => input.disabled = true);
        });
        
        if (updateCuisineBtn && householdData.lastCuisineUpdate) {
            const lastUpdate = householdData.lastCuisineUpdate.toDate();
            const now = new Date();
            const thirtyDaysInMillis = 30 * 24 * 60 * 60 * 1000;
            
            if (now - lastUpdate < thirtyDaysInMillis) {
                updateCuisineBtn.disabled = true;
                if(cuisineSelect) cuisineSelect.disabled = true; 
                updateCuisineBtn.textContent = `Update available on ${new Date(lastUpdate.getTime() + thirtyDaysInMillis).toLocaleDateString()}`;
            } else {
                updateCuisineBtn.disabled = false;
                if(cuisineSelect) cuisineSelect.disabled = false; 
                updateCuisineBtn.textContent = 'Update Cuisine (1 free change)';
            }
            updateCuisineBtn.style.display = 'block';
        }
        if(cuisineSelect) cuisineSelect.value = householdData.cuisine || "";

    } else { // Paid tier
        if (upgradeBtnHeader) upgradeBtnHeader.style.display = 'none';
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
    if(householdStatusInfo) householdStatusInfo.textContent = statusText;
}

async function saveUserPreferences() {
    if (!currentUser) return;
    const allergies = Array.from(document.querySelectorAll('input[name="plannerCriteria"]:checked, input[name="recipeCriteria"]:checked'))
                           .map(cb => cb.value);
    
    userPreferences.allergies = [...new Set(allergies)];
    
    const userDocRef = doc(db, 'users', currentUser.uid);
    await updateDoc(userDocRef, { preferences: userPreferences });
}

function loadUserPreferences() {
    if (userPreferences.allergies) {
        document.querySelectorAll('input[name="plannerCriteria"], input[name="recipeCriteria"]').forEach(checkbox => {
            if (userPreferences.allergies.includes(checkbox.value)) {
                checkbox.checked = true;
            }
        });
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
        alert(`${dayFullName} is already fully planned!`);
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
        console.error(`Error planning day ${dayFullName}:`, error);
        alert(`Could not plan ${dayFullName}: ${error.message}`);
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

function startApp() {
    populateCategoryDropdown(document.getElementById('manual-category'));
    populateCategoryDropdown(document.getElementById('grocery-item-category'));
    
    selectAllGroceryCheckbox = document.getElementById('select-all-grocery-checkbox');
    selectAllPantryCheckbox = document.getElementById('select-all-pantry-checkbox');
    
    if(selectAllGroceryCheckbox) selectAllGroceryCheckbox.addEventListener('change', handleSelectAllGrocery);
    if(document.getElementById('delete-selected-grocery-btn')) document.getElementById('delete-selected-grocery-btn').addEventListener('click', () => handleBulkDelete(getGroceryListRef(), '.grocery-item input[type="checkbox"]:checked'));
    if(selectAllPantryCheckbox) selectAllPantryCheckbox.addEventListener('change', (e) => {
        document.querySelectorAll('.pantry-item-checkbox').forEach(cb => cb.checked = e.target.checked);
        handlePantryItemCheck();
    });
    if(document.getElementById('delete-selected-pantry-btn')) document.getElementById('delete-selected-pantry-btn').addEventListener('click', () => handleBulkDelete(getPantryRef(), '.pantry-item-checkbox:checked'));
    
    displayPantryItems();
    updateWeekView();
    displayGroceryList();
    listenToFavorites();
    configurePaywallUI();
    loadUserPreferences();
}

async function handlePlanMyWeek() {
    const planMyWeekBtn = document.getElementById('plan-my-week-btn');
    if (planMyWeekBtn.classList.contains('disabled')) {
        alert('This is a premium feature! Please upgrade to use automatic week planning.');
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
        alert("Your week has been planned, but one or more days failed to generate.");
    } else {
        alert("Your week's empty slots have been filled!");
    }
}

function renderAddToPlanCalendar(year, month) {
    const calendarGrid = document.getElementById('calendar-grid');
    const calendarMonthYear = document.getElementById('calendar-month-year');
    calendarGrid.innerHTML = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    calendarMonthYear.textContent = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(day => {
        const dayNameEl = document.createElement('div');
        dayNameEl.className = 'calendar-day-name';
        dayNameEl.textContent = day;
        calendarGrid.appendChild(dayNameEl);
    });

    for (let i = 0; i < firstDay; i++) {
        calendarGrid.appendChild(document.createElement('div'));
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.textContent = day;
        const thisDate = new Date(year, month, day);
        thisDate.setHours(0, 0, 0, 0);
        dayEl.dataset.date = thisDate.toISOString();

        if (thisDate.getTime() === today.getTime()) {
            dayEl.classList.add('today');
        }

        if (selectedDates.some(d => new Date(d).getTime() === thisDate.getTime())) {
            dayEl.classList.add('selected');
        }

        calendarGrid.appendChild(dayEl);
    }
}

async function renderSidebarCalendar() {
    const container = document.getElementById('sidebar-calendar-container');
    if (!container || !householdId) return;

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();

    container.innerHTML = `
        <div id="sidebar-calendar-header">
            <h5>${today.toLocaleString('default', { month: 'long', year: 'numeric' })}</h5>
        </div>
        <div id="sidebar-calendar-grid"></div>
    `;

    const grid = document.getElementById('sidebar-calendar-grid');
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
            updateWeekView();
        });

        grid.appendChild(dayEl);
    }
    
    // Fetch all meal plans for the month to highlight days
    const mealPlanCollectionRef = collection(db, 'households', householdId, 'mealPlan');
    const q = query(mealPlanCollectionRef, where('__name__', '>=', `${year}-W01`), where('__name__', '<=', `${year}-W53`));
    const querySnapshot = await getDocs(q);
    const plannedDays = new Set();
    querySnapshot.forEach(doc => {
        const plan = doc.data().meals;
        if (plan) {
            Object.keys(plan).forEach(dayKey => {
                // This is a simplified way to get the date. A more robust solution would be needed for multi-year views.
                const weekId = doc.id;
                const [planYear, weekNum] = weekId.split('-W');
                const janFirst = new Date(planYear, 0, 1);
                const days = (weekNum - 1) * 7;
                const date = new Date(janFirst.valueOf() + days * 86400000);
                const dayIndex = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(dayKey);
                date.setDate(date.getDate() - date.getDay() + dayIndex);

                if (date.getMonth() === month) {
                    plannedDays.add(date.getDate());
                }
            });
        }
    });

    grid.querySelectorAll('.sidebar-calendar-day').forEach(dayEl => {
        const dayNum = parseInt(dayEl.textContent);
        if (plannedDays.has(dayNum)) {
            dayEl.classList.add('has-meal');
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

// --- AUTH STATE CHANGE & INITIALIZATION ---
onAuthStateChanged(auth, async user => {
    const initialView = document.getElementById('initial-view');
    const appContent = document.getElementById('app-content');
    const loginSection = document.getElementById('login-section');
    const householdManager = document.getElementById('household-manager');

    if (user) {
        await initializeAppUI(user);
    } else {
        currentUser = null; householdId = null; 
        unsubscribeHousehold();
        unsubscribeMealPlan();
        unsubscribeFavorites();
        
        renderAuthUI(null);
        buildLoginForm();
        
        initialView.style.display = 'block';
        loginSection.style.display = 'block';
        loginSection.classList.add('active');
        householdManager.style.display = 'none';
        householdManager.classList.remove('active');
        appContent.style.display = 'none';
    }
});

// --- Auth handlers (to be called from the new UI) ---
function handleGoogleSignIn() {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).catch(error => console.error("Sign in error", error));
}
async function handleEmailSignIn(e) {
    e.preventDefault();
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const authError = document.getElementById('auth-error');
    authError.style.display = 'none';
    try {
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
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: displayName });
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
        alert("Could not initiate payment. Please try again.");
    }
}

async function initializeAppUI(user) {
    currentUser = user;
    renderAuthUI(user);

    const userDocRef = doc(db, 'users', user.uid);
    let userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
        await setDoc(userDocRef, {
            email: user.email,
            householdId: null,
            hasSeenHowToGuide: false,
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
                        <span>Invite Code: <strong id="household-code-text">${householdId}</strong></span>
                        <button id="copy-household-code-btn" title="Copy Code"><i class="far fa-copy"></i></button>
                    `;
                    householdInfoEl.style.display = 'flex';
                }
                if(householdStatusInfoEl) householdStatusInfoEl.style.display = 'block';

                configurePaywallUI();
            }
        });

        startApp();
        if (!userDoc.data().hasSeenHowToGuide) {
            showHowToModal();
        }
    } else {
        document.getElementById('initial-view').style.display = 'block';
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('household-manager').style.display = 'block';
        document.getElementById('household-manager').classList.add('active');
        document.getElementById('app-content').style.display = 'none';
    }
}

// --- MAIN EVENT LISTENER ---
document.addEventListener('DOMContentLoaded', () => {
    populateCuisineDropdowns();
    
    // Static listeners
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
        if (!currentUser) return;
        const householdCuisineSelect = document.getElementById('household-cuisine-select');
        const selectedCuisine = householdCuisineSelect.value;
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
        batch.set(userRef, { email: currentUser.email, householdId: newHouseholdId, hasSeenHowToGuide: false, preferences: {} });
        
        await batch.commit();
        document.getElementById('create-household-modal').style.display = 'none';
        await initializeAppUI(currentUser);
    });

    document.getElementById('join-household-btn').addEventListener('click', async () => {
        if (!currentUser) return;
        const code = document.getElementById('household-code-input').value.trim().toUpperCase();
        if (!code) return alert("Please enter a household code.");
        
        const householdRef = doc(db, 'households', code);
        const householdDoc = await getDoc(householdRef);
        if (!householdDoc.exists()) return alert("Household not found.");
        
        const userRef = doc(db, 'users', currentUser.uid);
        const batch = writeBatch(db);
        batch.update(householdRef, { members: arrayUnion(currentUser.uid) });
        batch.set(userRef, { email: currentUser.email, householdId: code });
        
        await batch.commit();
        await initializeAppUI(currentUser);
    });

    // Delegated event listeners for dynamically added content
    document.body.addEventListener('click', (event) => {
        const target = event.target;
        
        if (target.closest('.close-btn')) target.closest('.modal').style.display = 'none';
        if (event.target.classList.contains('modal')) event.target.style.display = 'none';
        if (target.closest('#feedback-btn-sidebar')) document.getElementById('feedback-modal').style.display = 'block';
        if (target.closest('#copy-household-code-btn')) {
            const code = document.getElementById('household-code-text').textContent;
            navigator.clipboard.writeText(code).then(() => showToast('Household code copied!'));
        }
        if (target.closest('#pantry-list')) handlePantryClick(event);
        if (target.closest('#grocery-list')) handleGroceryListClick(event);
        if (target.closest('#recipe-results') || target.closest('#favorite-recipes-container')) handleCardClick(event);
        if (target.closest('#meal-planner-grid')) {
            // Clicks on the meal planner grid are now handled inside renderMealPlanner for day headers
            // and here for meal slots to avoid double-firing.
            if (target.closest('.meal-slot')) {
                 handleMealSlotClick(event);
            }
            handlePlanSingleDayClick(event);
        }
        if (target.closest('.modal-recipe-item')) handleModalClick(event);
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
            alert('Cuisine preference updated!');
        }
    });

    // Form Submissions and other specific listeners
    document.getElementById('manual-add-form')?.addEventListener('submit', handleManualAdd);
    document.getElementById('add-to-pantry-btn')?.addEventListener('click', addItemsToPantry);
    document.getElementById('item-confirmation-list')?.addEventListener('click', handleRemoveConfirmedItem);
    document.getElementById('suggest-recipe-btn')?.addEventListener('click', getRecipeSuggestions);
    document.getElementById('discover-recipes-btn')?.addEventListener('click', discoverNewRecipes);
    document.getElementById('quick-meal-btn')?.addEventListener('click', () => openCameraFor('quickMeal', document.getElementById('recipe-scan-ui-placeholder')));
    document.getElementById('show-scan-item-btn')?.addEventListener('click', () => openCameraFor('pantry', document.getElementById('add-item-container')));
    document.getElementById('show-scan-receipt-btn')?.addEventListener('click', () => openCameraFor('receipt', document.getElementById('add-item-container')));
    document.getElementById('show-manual-add-btn')?.addEventListener('click', () => {
        document.getElementById('add-item-container').style.display = 'block';
        document.getElementById('manual-add-container').style.display = 'block';
        document.getElementById('confirmation-section').style.display = 'none';
        stopCamera();
    });
    document.getElementById('start-camera-btn')?.addEventListener('click', startCamera);
    document.getElementById('capture-btn')?.addEventListener('click', captureAndScan);
    document.getElementById('close-scan-btn')?.addEventListener('click', () => {
        stopCamera();
        document.getElementById('scan-item-container').style.display = 'none';
    });
    document.getElementById('add-grocery-item-form')?.addEventListener('submit', handleAddGroceryItem);
    document.getElementById('move-to-pantry-btn')?.addEventListener('click', moveSelectedItemsToPantryDirectly);
    document.getElementById('show-add-grocery-form-btn')?.addEventListener('click', () => {
        const form = document.getElementById('add-grocery-item-form');
        form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
    document.getElementById('show-scan-grocery-btn')?.addEventListener('click', () => openCameraFor('grocery', document.getElementById('grocery-scan-ui-placeholder')));
    document.getElementById('show-scan-receipt-grocery-btn')?.addEventListener('click', () => openCameraFor('groceryReceipt', document.getElementById('grocery-scan-ui-placeholder')));
    document.getElementById('generate-grocery-list-btn')?.addEventListener('click', generateAutomatedGroceryList);
    document.getElementById('prev-week-btn')?.addEventListener('click', () => navigateWeek('prev'));
    document.getElementById('next-week-btn')?.addEventListener('click', () => navigateWeek('next'));
    document.getElementById('show-ideas-tab')?.addEventListener('click', (e) => {
        document.getElementById('ideas-content').style.display = 'block';
        document.getElementById('recipe-results').style.display = 'grid';
        document.getElementById('favorite-recipes-container').style.display = 'none';
        e.target.classList.add('active');
        document.getElementById('show-favorites-tab').classList.remove('active');
    });
    document.getElementById('show-favorites-tab')?.addEventListener('click', (e) => {
        document.getElementById('ideas-content').style.display = 'none';
        document.getElementById('recipe-results').style.display = 'none';
        document.getElementById('favorite-recipes-container').style.display = 'block';
        e.target.classList.add('active');
        document.getElementById('show-ideas-tab').classList.remove('active');
    });
    document.getElementById('add-to-plan-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const meal = document.getElementById('meal-select').value;
        if (currentRecipeToPlan && selectedDates.length > 0 && meal) {
            for (const dateString of selectedDates) {
                await addRecipeToPlan(new Date(dateString), meal, currentRecipeToPlan);
            }
            currentDate = new Date(selectedDates[0]);
            document.getElementById('add-to-plan-modal').style.display = 'none';
            currentRecipeToPlan = null;
            selectedDates = [];
            showToast('Recipe added to selected dates!');
            updateWeekView(); 
        } else {
            alert('Please select at least one date.');
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
            alert('Please enter a meal to ask the chef!');
            return;
        }
        showLoadingState(`Your Chef is creating a "${mealQuery}" recipe...`, document.getElementById('recipe-results'));
        try {
            const askTheChefFunc = httpsCallable(functions, 'askTheChef');
            const result = await askTheChefFunc({ mealQuery, unitSystem });
            displayRecipeResults([result.data], 'your custom');
            queryInput.value = '';
        } catch (error) {
            console.error("Error asking the chef:", error);
            document.getElementById('recipe-results').innerHTML = `<p>Sorry, the chef couldn't find a recipe for that.</p>`;
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
                alert('Sorry, there was an issue submitting your feedback.');
            }
        }
    });
    document.getElementById('sync-calendar-btn')?.addEventListener('click', () => {
        const syncCalendarBtn = document.getElementById('sync-calendar-btn');
        if (syncCalendarBtn.classList.contains('disabled')) {
            alert('This is a premium feature! Please upgrade to use calendar sync.');
            return;
        }
        if (householdId) {
            const functionUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/calendarFeed?householdId=${householdId}`;
            document.getElementById('calendar-url-input').value = functionUrl;
            document.getElementById('sync-calendar-modal').style.display = 'block';
        } else {
            alert('Could not generate calendar link. Household not found.');
        }
    });
    document.querySelectorAll('input[name="plannerCriteria"], input[name="recipeCriteria"]').forEach(checkbox => {
        checkbox.addEventListener('change', saveUserPreferences);
    });
});