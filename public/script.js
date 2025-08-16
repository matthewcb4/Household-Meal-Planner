// Import all necessary functions from the Firebase SDKs at the top
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, getDocs, onSnapshot, query, where, writeBatch, arrayUnion, serverTimestamp, deleteDoc, orderBy, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD-NEXCNVe8GuAeuKvcgvmgy7A01kZhgKI",
  authDomain: "family-dinner-app-79249.firebaseapp.com",
  projectId: "family-dinner-app-79249",
  storageBucket: "family-dinner-app-79249.firebasestorage.app",
  messagingSenderId: "665272276696",
  appId: "1:665272276696:web:599165b284256c907e69ad",
  measurementId: "G-YLVBPLNDWF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app);
const stripe = Stripe('pk_test_51RwOd6BUsDNfnENv0mtyJjaK1DBMG3UKHGKgdcHQ34ZrdTNli9UVpWbZAmksP3kwrsTZaARSJcPFE8llpNMPVloT008eEcwyqd');


// --- GLOBAL VARIABLES ---
let currentUser = null, householdId = null, stream = null, scanMode = 'pantry', currentDate = new Date(), unsubscribeMealPlan = () => {}, selectAllGroceryCheckbox = null, selectAllPantryCheckbox = null, currentRecipeToPlan = null, householdData = null;
let unitSystem = 'imperial';
let calendarDate = new Date(); 
let selectedDates = []; 
let currentHowToSlide = 0;

const PANTRY_CATEGORIES = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"];
const CUISINE_OPTIONS = ["American", "Asian", "French", "Greek", "Indian", "Italian", "Mediterranean", "Mexican", "Spanish", "Thai"];


// --- DOM ELEMENT REFERENCES ---
const signInBtn = document.getElementById('sign-in-btn');
const signOutBtn = document.getElementById('sign-out-btn');
const welcomeMessage = document.getElementById('welcome-message');
const appContent = document.getElementById('app-content');
const householdManager = document.getElementById('household-manager');
const createHouseholdBtn = document.getElementById('create-household-btn');
const joinHouseholdBtn = document.getElementById('join-household-btn');
const householdCodeInput = document.getElementById('household-code-input');
const householdInfo = document.getElementById('household-info');
const householdStatusInfo = document.getElementById('household-status-info');
const startCameraBtn = document.getElementById('start-camera-btn');
const captureBtn = document.getElementById('capture-btn');
const addToPantryBtn = document.getElementById('add-to-pantry-btn');
const suggestRecipeBtn = document.getElementById('suggest-recipe-btn');
const quickMealBtn = document.getElementById('quick-meal-btn');
const manualAddForm = document.getElementById('manual-add-form');
const manualCategorySelect = document.getElementById('manual-category');
const itemConfirmationList = document.getElementById('item-confirmation-list');
const pantryListDiv = document.getElementById('pantry-list');
const recipeResultsDiv = document.getElementById('recipe-results');
const cameraContainer = document.getElementById('camera-container');
const videoElement = document.getElementById('camera-stream');
const canvasElement = document.getElementById('capture-canvas');
const capturedImageElement = document.getElementById('captured-image');
const expandAllBtn = document.getElementById('expand-all-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');
const showManualAddBtn = document.getElementById('show-manual-add-btn');
const showScanItemBtn = document.getElementById('show-scan-item-btn');
const showScanReceiptBtn = document.getElementById('show-scan-receipt-btn');
const addItemContainer = document.getElementById('add-item-container');
const manualAddContainer = document.getElementById('manual-add-container');
const scanItemContainer = document.getElementById('scan-item-container');
const confirmationSection = document.getElementById('confirmation-section');
const addGroceryItemForm = document.getElementById('add-grocery-item-form');
const groceryList = document.getElementById('grocery-list');
const moveToPantryBtn = document.getElementById('move-to-pantry-btn');
const showAddGroceryFormBtn = document.getElementById('show-add-grocery-form-btn');
const showScanGroceryBtn = document.getElementById('show-scan-grocery-btn');
const showScanReceiptGroceryBtn = document.getElementById('show-scan-receipt-grocery-btn');
const moveToPantryFormContainer = document.getElementById('move-to-pantry-form-container');
const moveToPantryForm = document.getElementById('move-to-pantry-form');
const confirmMoveBtn = document.getElementById('confirm-move-btn');
const groceryScanUIPlaceholder = document.getElementById('grocery-scan-ui-placeholder');
const recipeScanUIPlaceholder = document.getElementById('recipe-scan-ui-placeholder');
const favoriteRecipesList = document.getElementById('favorite-recipes-list');
const groceryItemCategorySelect = document.getElementById('grocery-item-category');
const mealPlannerGrid = document.getElementById('meal-planner-grid');
const generateGroceryListBtn = document.getElementById('generate-grocery-list-btn');
const prevWeekBtn = document.getElementById('prev-week-btn');
const nextWeekBtn = document.getElementById('next-week-btn');
const weekRangeDisplay = document.getElementById('week-range-display');
const showIdeasTab = document.getElementById('show-ideas-tab');
const showFavoritesTab = document.getElementById('show-favorites-tab');
const ideasContent = document.getElementById('ideas-content');
const mealPlanModal = document.getElementById('meal-plan-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalSlotTitle = document.getElementById('modal-slot-title');
const modalRecipeList = document.getElementById('modal-recipe-list');
const discoverRecipesBtn = document.getElementById('discover-recipes-btn');
const addToPlanModal = document.getElementById('add-to-plan-modal');
const addToPlanModalCloseBtn = document.getElementById('add-to-plan-modal-close-btn');
const addToPlanForm = document.getElementById('add-to-plan-form');
const addToPlanRecipeTitle = document.getElementById('add-to-plan-recipe-title');
const cuisineSelect = document.getElementById('cuisine-select');
const updateCuisineBtn = document.getElementById('update-cuisine-btn');
const createHouseholdModal = document.getElementById('create-household-modal');
const createHouseholdForm = document.getElementById('create-household-form');
const createHouseholdModalCloseBtn = document.getElementById('create-household-modal-close-btn');
const householdCuisineSelect = document.getElementById('household-cuisine-select');
const planMyWeekBtn = document.getElementById('plan-my-week-btn');
const calendarPrevMonthBtn = document.getElementById('calendar-prev-month');
const calendarNextMonthBtn = document.getElementById('calendar-next-month');
const calendarMonthYear = document.getElementById('calendar-month-year');
const calendarGrid = document.getElementById('calendar-grid');
const askTheChefForm = document.getElementById('ask-the-chef-form');
const groceryBulkControls = document.getElementById('grocery-bulk-controls');
const deleteSelectedGroceryBtn = document.getElementById('delete-selected-grocery-btn');
const pantryBulkControls = document.getElementById('pantry-bulk-controls');
const deleteSelectedPantryBtn = document.getElementById('delete-selected-pantry-btn');
const signInOptions = document.getElementById('sign-in-options');
const howToModal = document.getElementById('how-to-modal');
const howToSlides = document.querySelectorAll('.how-to-slide');
const howToPrevBtn = document.getElementById('how-to-prev-btn');
const howToNextBtn = document.getElementById('how-to-next-btn');
const howToCloseBtn = document.getElementById('how-to-close-btn');
const howToDotsContainer = document.querySelector('.how-to-dots');
const emailSigninForm = document.getElementById('email-signin-form');
const emailSignupForm = document.getElementById('email-signup-form');
const toggleAuthModeBtn = document.getElementById('toggle-auth-mode');
const authError = document.getElementById('auth-error');
const upgradeBtnHeader = document.getElementById('upgrade-btn-header');
const expandAllGroceryBtn = document.getElementById('expand-all-grocery-btn');
const collapseAllGroceryBtn = document.getElementById('collapse-all-grocery-btn');
const feedbackBtn = document.getElementById('feedback-btn');
const feedbackModal = document.getElementById('feedback-modal');
const feedbackModalCloseBtn = document.getElementById('feedback-modal-close-btn');
const feedbackForm = document.getElementById('feedback-form');


// --- HELPER FUNCTIONS ---

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
    selectElement.innerHTML = '';
    PANTRY_CATEGORIES.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        selectElement.appendChild(option);
    });
}

function populateCuisineDropdowns() {
    const selects = [cuisineSelect, householdCuisineSelect];
    selects.forEach(select => {
        if (select) {
            const currentValue = select.value;
            // Keep the "Any" option if it exists
            const anyOption = select.querySelector('option[value=""]');
            select.innerHTML = '';
            if (anyOption) {
                select.appendChild(anyOption);
            }
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


function showLoadingState(message, container = recipeResultsDiv) {
    container.innerHTML = `
        <div class="loading-card">
            <div class="loading-spinner"></div>
            <p>${message}</p>
        </div>
    `;
}

async function displayPantryItems() {
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
        if (!groupedItems[item.category]) { groupedItems[item.category] = []; }
        groupedItems[item.category].push(item);
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
}

async function displayGroceryList() {
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
}


async function displayFavoriteRecipes() {
    const favoritesRef = getFavoritesRef();
    if (!favoritesRef) return;
    favoriteRecipesList.innerHTML = '<p>Loading favorites...</p>';
    const snapshot = await getDocs(favoritesRef);
    if (snapshot.empty) {
        favoriteRecipesList.innerHTML = '<p>You haven\'t saved any favorite recipes yet.</p>';
        return;
    }
    favoriteRecipesList.innerHTML = '';
    snapshot.forEach(doc => {
        const recipe = { id: doc.id, ...doc.data() };
        const recipeCard = createRecipeCard(recipe, true);
        favoriteRecipesList.appendChild(recipeCard);
    });
}

function displayWeekRange() {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); 
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    weekRangeDisplay.textContent = `${startOfWeek.toLocaleDateString()} - ${endOfWeek.toLocaleDateString()}`;
}

function renderMealPlanner() {
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
                Object.keys(meals[day]).forEach(meal => {
                    const slot = document.querySelector(`.meal-slot[data-day="${day}"][data-meal="${meal}"]`);
                    if (slot) {
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
            });
        }
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
    const allItemCheckboxes = groceryList.querySelectorAll('.grocery-item input[type="checkbox"]');
    const checkedItems = groceryList.querySelectorAll('.grocery-item input[type="checkbox"]:checked');

    moveToPantryBtn.style.display = checkedItems.length > 0 ? 'block' : 'none';
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
        const container = selectAllGroceryCheckbox.parentElement.parentElement; // Changed to parentElement
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
    const isChecked = event.target.checked;
    const allCheckboxes = groceryList.querySelectorAll('.grocery-item input[type="checkbox"]');
    allCheckboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
    });
    handleGroceryItemCheck();
}

function handlePantryItemCheck() {
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
    const target = event.target;
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
        if (list && list.tagName === 'UL') {
            const isVisible = list.style.display !== 'none';
            list.style.display = isVisible ? 'none' : 'block';
            toggle.textContent = isVisible ? '+' : '−';
        }
    }

    if (event.target.classList.contains('delete-pantry-item-btn')) {
        const itemId = event.target.dataset.id;
        if (confirm("Are you sure you want to remove this item from your pantry?")) {
            deleteDoc(doc(getPantryRef(), itemId)).then(() => displayPantryItems());
        }
    }

    if (event.target.type === 'checkbox') {
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
    const category = manualCategorySelect.value;
    if (name && !isNaN(quantity) && quantity > 0) {
        const q = query(pantryRef, where('name', '==', name));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            const existingQuantity = doc.data().quantity || 0;
            await updateDoc(doc.ref, { quantity: existingQuantity + quantity });
        } else {
            await addDoc(pantryRef, { name, quantity, unit, category, addedBy: currentUser.email });
        }

        displayPantryItems();
        manualAddForm.reset();
        addItemContainer.style.display = 'none';
    }
}

async function addItemsToPantry() {
    const pantryRef = getPantryRef();
    if (!pantryRef) return;
    const confirmedItems = itemConfirmationList.querySelectorAll('.confirmation-item');
    if (confirmedItems.length === 0) {
        alert("No items to add!");
        return;
    }

    const pantrySnapshot = await getDocs(pantryRef);
    const existingPantryItems = {};
    pantrySnapshot.forEach(doc => {
        existingPantryItems[doc.data().name] = { id: doc.id, ...doc.data() };
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
                const newItemRef = doc(collection(pantryRef));
                batch.set(newItemRef, { name, quantity, unit, category, addedBy: currentUser.email });
            }
        }
    });
    await batch.commit();
    displayPantryItems();
    confirmationSection.style.display = 'none';
    addItemContainer.style.display = 'none';
}

async function getRecipeSuggestions() {
    const pantryRef = getPantryRef();
    if (!pantryRef) {
        recipeResultsDiv.innerHTML = "<p>Error: Not in a household.</p>";
        return;
    }
    const snapshot = await getDocs(pantryRef);
    const pantryItems = snapshot.docs.map(doc => doc.data().name);
    if (pantryItems.length === 0) {
        recipeResultsDiv.innerHTML = "<p>Your pantry is empty. Add some items to get suggestions.</p>";
        return;
    }
    await generateRecipes(pantryItems, 'Suggest from Pantry');
}

async function discoverNewRecipes() {
    await generateRecipes(null, 'Discover New Recipes');
}

async function generateRecipes(items, source) {
    const selectedMealType = document.querySelector('input[name="mealType"]:checked').value;
    const selectedCuisine = cuisineSelect.value;
    const selectedCriteria = Array.from(document.querySelectorAll('input[name="recipeCriteria"]:checked')).map(cb => cb.value);

    let loadingMessage = `Your Chef is creating ${selectedCuisine} ${selectedMealType} recipes...`;
    showLoadingState(loadingMessage);

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

function displayRecipeResults(recipes, mealType) {
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

        const recipeCard = createRecipeCard(recipe, isFavorite);
        recipeResultsDiv.appendChild(recipeCard);
    });
}

function createRecipeCard(recipe, isFavorite) {
    const recipeCard = document.createElement('div');
    recipeCard.className = 'recipe-card';
    recipeCard.draggable = true;
    recipeCard.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/json', JSON.stringify(recipe));
        e.dataTransfer.effectAllowed = 'copy';
    });

    const imageUrl = recipe.imageUrl || `https://placehold.co/600x400/EEE/31343C?text=${encodeURIComponent(recipe.imageQuery || recipe.title)}`;

    let ingredientsHTML = '<ul>';
    if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
        recipe.ingredients.forEach(ing => {
            const ingredientText = `${ing.quantity || ''} ${ing.unit || ''} ${ing.name || ''}`.trim();
            const ingredientName = ing.name || '';
            const ingredientCategory = ing.category || 'Other';
            
            if (ingredientName) { 
                ingredientsHTML += `<li>${ingredientText} <button class="add-to-list-btn secondary" data-item-name="${escapeAttr(ingredientName)}" data-item-category="${escapeAttr(ingredientCategory)}">+ List</button></li>`;
            }
        });
    }
    ingredientsHTML += '</ul>';

    const googleSearchQuery = encodeURIComponent(`${recipe.title} recipe`);
    const googleSearchUrl = `https://www.google.com/search?q=${googleSearchQuery}`;
    
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

    const cardActionsHTML = `
        <div class="card-actions">
            <button class="add-to-plan-btn">Add to Plan</button>
            ${instructionsHTML}
        </div>
    `;

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
        <strong>Ingredients Used:</strong>
        ${ingredientsHTML}
    `;

    recipeCard.innerHTML = `
        <img src="${imageUrl}" alt="${recipe.title}" class="recipe-image" onerror="this.onerror=null;this.src='https://placehold.co/600x400/EEE/31343C?text=Image+Not+Found';">
        <button class="save-recipe-btn ${isFavorite ? 'is-favorite' : ''}" title="${isFavorite ? 'Remove from Favorites' : 'Save to Favorites'}">⭐</button>
        <div class="recipe-card-content">${cardContent}</div>
    `;
    
    recipeCard.dataset.recipe = JSON.stringify(recipe);
    return recipeCard;
}


async function captureAndScan() {
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
                const newItemRef = doc(collection(groceryRef));
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
        scanMode = 'pantry'; // Reset to default
    }
}

function displayConfirmationForm(items) {
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
    if (stream) { stream.getTracks().forEach(track => track.stop()); }
    cameraContainer.style.display = 'none';
    startCameraBtn.style.display = 'block';
    captureBtn.style.display = 'none';
}

async function handleAddGroceryItem(event) {
    event.preventDefault();
    const groceryRef = getGroceryListRef();
    if (!groceryRef) return;
    const itemNameInput = document.getElementById('grocery-item-name');
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

    // Handle category expand/collapse
    const header = event.target.closest('.category-header');
    if (header) {
        const list = header.nextElementSibling;
        const toggle = header.querySelector('.category-toggle');
        if (list && list.tagName === 'UL') {
            const isVisible = list.style.display !== 'none';
            list.style.display = isVisible ? 'none' : 'block';
            toggle.textContent = isVisible ? '+' : '−';
        }
        return;
    }

    // Handle checkbox click
    if (event.target.type === 'checkbox') {
        const itemId = event.target.dataset.id;
        const isChecked = event.target.checked;
        if (itemId) {
            const itemRef = doc(groceryRef, itemId);
            await updateDoc(itemRef, { checked: isChecked });
        }
        handleGroceryItemCheck();
    }

    // Handle delete button click
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
        alert(`'${itemName}' added to your grocery list!`);
    }
}

async function toggleFavorite(recipeData, buttonElement) {
    const favoritesRef = getFavoritesRef();
    if (!favoritesRef || !recipeData) return;

    const q = query(favoritesRef, where("title", "==", recipeData.title));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        const dataToSave = { ...recipeData };
        delete dataToSave.id;
        const docRef = await addDoc(favoritesRef, dataToSave);
        alert(`"${recipeData.title}" saved to favorites!`);
        if (buttonElement) {
            buttonElement.classList.add('is-favorite');
            buttonElement.title = 'Remove from Favorites';
            const card = buttonElement.closest('.recipe-card');
            const currentData = JSON.parse(card.dataset.recipe);
            currentData.id = docRef.id;
            card.dataset.recipe = JSON.stringify(currentData);
        }
    } else {
        const docId = querySnapshot.docs[0].id;
        await deleteDoc(doc(favoritesRef, docId));
        alert(`"${recipeData.title}" removed from favorites.`);
        if (buttonElement) {
            buttonElement.classList.remove('is-favorite');
            buttonElement.title = 'Save to Favorites';
        }
    }
    if (favoriteRecipesList.style.display !== 'none') {
        displayFavoriteRecipes();
    }
}

function handleCardClick(event) {
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
        addToPlanRecipeTitle.textContent = currentRecipeToPlan.title;
        selectedDates = []; 
        calendarDate = new Date(); 
        renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
        addToPlanModal.style.display = 'block';
    } else if (target.closest('.instructions-toggle')) {
        const button = target.closest('.instructions-toggle');
        const list = button.closest('.instructions-container').querySelector('.instructions-list');
        if (list) {
            const isVisible = list.style.display === 'block';
            list.style.display = isVisible ? 'none' : 'block';
            button.textContent = isVisible ? 'Show Instructions' : 'Hide Instructions';
        }
    } else if (target.closest('.star')) {
        const recipeId = target.closest('.star-rating').querySelector('.star').dataset.id;
        const newRating = parseInt(target.dataset.rating, 10);
        const favoritesRef = getFavoritesRef();
        if (favoritesRef && recipeId) {
            updateDoc(doc(favoritesRef, recipeId), { rating: newRating }).then(() => {
                const starContainer = target.parentElement;
                const stars = starContainer.querySelectorAll('.star');
                stars.forEach(star => {
                    star.classList.toggle('filled', parseInt(star.dataset.rating, 10) <= newRating);
                });
            });
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
        mealPlanModal.style.display = 'none';
    } else if (target.classList.contains('favorite-from-modal-btn')) {
        const recipeData = JSON.parse(card.dataset.recipe);
        await toggleFavorite(recipeData);
    } else if (target.classList.contains('add-to-plan-btn')) {
        currentRecipeToPlan = JSON.parse(card.dataset.recipe);
        addToPlanRecipeTitle.textContent = currentRecipeToPlan.title;
        selectedDates = [];
        calendarDate = new Date();
        renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
        mealPlanModal.style.display = 'none'; // Close current modal
        addToPlanModal.style.display = 'block'; // Open calendar modal
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

function handleExpandCollapseAll(expand) {
    const allLists = pantryListDiv.querySelectorAll('ul');
    const allToggles = pantryListDiv.querySelectorAll('.category-toggle');
    allLists.forEach(list => list.style.display = expand ? 'block' : 'none');
    allToggles.forEach(toggle => toggle.textContent = expand ? '−' : '+');
}

function handleExpandCollapseAllGrocery(expand) {
    const allLists = groceryList.querySelectorAll('ul');
    const allToggles = groceryList.querySelectorAll('.category-toggle');
    allLists.forEach(list => list.style.display = expand ? 'block' : 'none');
    allToggles.forEach(toggle => toggle.textContent = expand ? '−' : '+');
}


function handleRemoveConfirmedItem(event) {
    if (event.target.classList.contains('remove-item-btn')) {
        event.target.closest('.confirmation-item').remove();
    }
}

function openCameraFor(mode, placeholderElement) {
    scanMode = mode;
    placeholderElement.appendChild(scanItemContainer);
    scanItemContainer.style.display = 'block';
}

function navigateWeek(direction) {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + (direction === 'prev' ? -7 : 7));
    currentDate = newDate;
    updateWeekView();
}

async function generateAutomatedGroceryList() {
    alert("Generating grocery list... This may take a moment.");
    try {
        const generateList = httpsCallable(functions, 'generateGroceryList');
        const result = await generateList({ weekId: getWeekId(currentDate) });
        if (result.data.success) {
            alert(result.data.message);
            displayGroceryList();
        } else {
            throw new Error(result.data.error || "Unknown error");
        }
    } catch (error) {
        console.error("Error generating grocery list:", error);
        alert(`Could not generate grocery list: ${error.message}`);
    }
}

function switchTab(event) {
    const tabId = event.target.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(section => {
        section.classList.remove('active');
    });
    document.querySelectorAll('.tab-link').forEach(button => {
        button.classList.remove('active');
    });
    document.getElementById(tabId).classList.add('active');
    event.target.classList.add('active');
}

function configurePaywallUI() {
    if (!householdData) return;
    const premiumFeatures = document.querySelectorAll('.premium-feature');
    householdStatusInfo.textContent = `Status: ${householdData.subscriptionTier.charAt(0).toUpperCase() + householdData.subscriptionTier.slice(1)}`;

    if (householdData.subscriptionTier === 'free') {
        upgradeBtnHeader.style.display = 'block';
        premiumFeatures.forEach(el => el.classList.add('disabled'));
        
        const lastUpdate = householdData.lastCuisineUpdate.toDate();
        const now = new Date();
        const thirtyDaysInMillis = 30 * 24 * 60 * 60 * 1000;
        
        if (now - lastUpdate < thirtyDaysInMillis) {
            updateCuisineBtn.disabled = true;
            cuisineSelect.disabled = true; 
            updateCuisineBtn.textContent = `Update available on ${new Date(lastUpdate.getTime() + thirtyDaysInMillis).toLocaleDateString()}`;
        } else {
            updateCuisineBtn.disabled = false;
            cuisineSelect.disabled = false; 
            updateCuisineBtn.textContent = 'Update Cuisine (1 free change)';
        }
        updateCuisineBtn.style.display = 'block';
        cuisineSelect.value = householdData.cuisine || "";

    } else { // Paid tier
        upgradeBtnHeader.style.display = 'none';
        premiumFeatures.forEach(el => el.classList.remove('disabled'));
        updateCuisineBtn.style.display = 'block'; 
        updateCuisineBtn.disabled = false;
        updateCuisineBtn.textContent = 'Update Cuisine';
        cuisineSelect.disabled = false;
        cuisineSelect.value = householdData.cuisine || "";
    }
}


async function initializeAppUI(user) {
    currentUser = user;
    welcomeMessage.textContent = `Hello, ${user.displayName || user.email}!`;
    signInOptions.style.display = 'none';
    signOutBtn.style.display = 'block';
    welcomeMessage.style.display = 'inline';

    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists() && userDoc.data().householdId) {
        householdId = userDoc.data().householdId;
        const householdRef = doc(db, 'households', householdId);
        const householdDoc = await getDoc(householdRef);
        householdData = householdDoc.data();

        householdManager.style.display = 'none';
        appContent.style.display = 'block';
        householdInfo.textContent = `Invite Code: ${householdId}`;
        householdStatusInfo.style.display = 'block';
        startApp();
        if (!userDoc.data().hasSeenHowToGuide) {
            showHowToModal();
        }
    } else {
        householdManager.style.display = 'block';
        appContent.style.display = 'none';
        householdInfo.style.display = 'none';
        householdStatusInfo.style.display = 'none';
    }
}


// --- MAIN APP LOGIC & EVENT LISTENERS ---

async function handlePlanSingleDayClick(event) {
    const button = event.target.closest('.plan-day-btn');
    if (!button) return;

    const dayAbbr = button.dataset.day;
    const dayFullName = button.dataset.dayFullName;

    if (!confirm(`This will fill in any empty meals for ${dayFullName}. Are you sure? Make sure your preferences are set correctly.`)) {
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
    const finalCuisine = dailyCuisine || householdData.cuisine;
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
        const dayPlan = result.data;

        if (dayPlan && Object.keys(dayPlan).length > 0) {
            await setDoc(mealPlanRef, { meals: { [dayAbbr]: dayPlan } }, { merge: true });
        }

    } catch (error) {
        console.error(`Error planning day ${dayFullName}:`, error);
        alert(`Could not plan ${dayFullName}: ${error.message}`);
    } finally {
        button.textContent = originalButtonText;
        button.disabled = false;
    }
}


function startApp() {
    populateCategoryDropdown(manualCategorySelect);
    populateCategoryDropdown(groceryItemCategorySelect);
    populateCuisineDropdowns();

    selectAllGroceryCheckbox = document.getElementById('select-all-grocery-checkbox');
    selectAllPantryCheckbox = document.getElementById('select-all-pantry-checkbox');
    
    selectAllGroceryCheckbox.addEventListener('change', handleSelectAllGrocery);
    deleteSelectedGroceryBtn.addEventListener('click', () => handleBulkDelete(getGroceryListRef(), '.grocery-item input[type="checkbox"]:checked'));
    selectAllPantryCheckbox.addEventListener('change', (e) => {
        document.querySelectorAll('.pantry-item-checkbox').forEach(cb => cb.checked = e.target.checked);
        handlePantryItemCheck();
    });
    deleteSelectedPantryBtn.addEventListener('click', () => handleBulkDelete(getPantryRef(), '.pantry-item-checkbox:checked'));
    
    displayPantryItems();
    updateWeekView();
    displayGroceryList();
    displayFavoriteRecipes();
    configurePaywallUI();
}

async function handlePlanMyWeek() {
    if (planMyWeekBtn.classList.contains('disabled')) {
        alert('This is a premium feature! Please upgrade to use automatic week planning.');
        return;
    }

    if (!confirm("This will fill in any empty meals for the current week. Are you sure? Make sure your preferences are set correctly.")) {
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
            const finalCuisine = dailyCuisine || householdData.cuisine;

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
        alert("Your week has been planned, but one or more days failed to generate. Please try planning those days individually.");
    } else {
        alert("Your week's empty slots have been filled!");
    }
}

function renderAddToPlanCalendar(year, month) {
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

// --- How-To Modal Logic ---
function showHowToModal() {
    currentHowToSlide = 0;
    updateHowToSlider();
    howToModal.style.display = 'block';
}

function updateHowToSlider() {
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


// --- TOP-LEVEL EXECUTION ---

onAuthStateChanged(auth, async user => {
    if (user) {
        await initializeAppUI(user);
    } else {
        currentUser = null; householdId = null; 
        signInOptions.style.display = 'flex';
        signOutBtn.style.display = 'none';
        welcomeMessage.style.display = 'none';
        householdInfo.style.display = 'none';
        householdStatusInfo.style.display = 'none';
        appContent.style.display = 'none';
        householdManager.style.display = 'none';
    }
});

signInBtn.addEventListener('click', () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).catch(error => console.error("Sign in error", error));
});

signOutBtn.addEventListener('click', () => signOut(auth));

createHouseholdBtn.addEventListener('click', () => {
    createHouseholdModal.style.display = 'block';
});

createHouseholdModalCloseBtn.addEventListener('click', () => {
    createHouseholdModal.style.display = 'none';
});

createHouseholdForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
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
    batch.set(userRef, { email: currentUser.email, householdId: newHouseholdId, hasSeenHowToGuide: false });
    
    await batch.commit();
    createHouseholdModal.style.display = 'none';
    await initializeAppUI(currentUser);
});


joinHouseholdBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    const code = householdCodeInput.value.trim().toUpperCase();
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

updateCuisineBtn.addEventListener('click', async () => {
    if (!householdId || updateCuisineBtn.disabled) return;
    const newCuisine = cuisineSelect.value;
    const householdRef = doc(db, 'households', householdId);
    await updateDoc(householdRef, {
        cuisine: newCuisine,
        lastCuisineUpdate: serverTimestamp()
    });
    householdData.cuisine = newCuisine;
    householdData.lastCuisineUpdate = { toDate: () => new Date() };
    configurePaywallUI();
    alert('Cuisine preference updated!');
});

// --- Email Auth Listeners ---
emailSigninForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    authError.style.display = 'none';
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        authError.textContent = error.message;
        authError.style.display = 'block';
    }
});

emailSignupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signup-email-input').value;
    const password = document.getElementById('signup-password-input').value;
    const displayName = document.getElementById('signup-display-name-input').value;
    authError.style.display = 'none';
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: displayName });
        // The onAuthStateChanged listener will handle the rest of the UI update.
    } catch (error) {
        authError.textContent = error.message;
        authError.style.display = 'block';
    }
});

toggleAuthModeBtn.addEventListener('click', () => {
    const isSignInVisible = emailSigninForm.style.display !== 'none';
    emailSigninForm.style.display = isSignInVisible ? 'none' : 'block';
    emailSignupForm.style.display = isSignInVisible ? 'block' : 'none';
    toggleAuthModeBtn.textContent = isSignInVisible ? 'Have an account? Sign In' : 'Need an account? Sign Up';
    authError.style.display = 'none';
});


// --- Initialize Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-link').forEach(button => button.addEventListener('click', switchTab));
    pantryListDiv.addEventListener('click', handlePantryClick);
    manualAddForm.addEventListener('submit', handleManualAdd);
    addToPantryBtn.addEventListener('click', addItemsToPantry);
    suggestRecipeBtn.addEventListener('click', getRecipeSuggestions);
    discoverRecipesBtn.addEventListener('click', discoverNewRecipes);
    
    quickMealBtn.addEventListener('click', () => {
        const isVisible = recipeScanUIPlaceholder.contains(scanItemContainer) && scanItemContainer.style.display === 'block';
        if (isVisible) {
            scanItemContainer.style.display = 'none';
            stopCamera();
        } else {
            addItemContainer.style.display = 'none';
            openCameraFor('quickMeal', recipeScanUIPlaceholder);
        }
    });

    showScanItemBtn.addEventListener('click', () => {
        const isVisible = addItemContainer.contains(scanItemContainer) && scanItemContainer.style.display === 'block';
        manualAddContainer.style.display = 'none';

        if (isVisible && scanMode === 'pantry') {
            addItemContainer.style.display = 'none';
            stopCamera();
        } else {
            addItemContainer.style.display = 'block';
            if (recipeScanUIPlaceholder.contains(scanItemContainer)) {
                recipeScanUIPlaceholder.innerHTML = ''; 
            }
            openCameraFor('pantry', addItemContainer);
        }
    });

    showScanReceiptBtn.addEventListener('click', () => {
        const isVisible = addItemContainer.contains(scanItemContainer) && scanItemContainer.style.display === 'block';
        manualAddContainer.style.display = 'none';

        if (isVisible && scanMode === 'receipt') {
            addItemContainer.style.display = 'none';
            stopCamera();
        } else {
            addItemContainer.style.display = 'block';
            if (recipeScanUIPlaceholder.contains(scanItemContainer)) {
                recipeScanUIPlaceholder.innerHTML = '';
            }
            openCameraFor('receipt', addItemContainer);
        }
    });

    showManualAddBtn.addEventListener('click', () => {
        const isVisible = manualAddContainer.style.display === 'block';
        addItemContainer.style.display = isVisible ? 'none' : 'block';
        manualAddContainer.style.display = isVisible ? 'none' : 'block';
        scanItemContainer.style.display = 'none';
        confirmationSection.style.display = 'none';
        stopCamera();
    });

    startCameraBtn.addEventListener('click', startCamera);
    captureBtn.addEventListener('click', captureAndScan);
    
    addGroceryItemForm.addEventListener('submit', handleAddGroceryItem);
    groceryList.addEventListener('click', handleGroceryListClick);
    moveToPantryBtn.addEventListener('click', moveSelectedItemsToPantryDirectly);
    recipeResultsDiv.addEventListener('click', handleCardClick);
    favoriteRecipesList.addEventListener('click', handleCardClick);
    showAddGroceryFormBtn.addEventListener('click', () => {
        addGroceryItemForm.style.display = addGroceryItemForm.style.display === 'none' ? 'flex' : 'none';
    });
    showScanGroceryBtn.addEventListener('click', () => {
        const isScanUIVisible = groceryScanUIPlaceholder.contains(scanItemContainer) && scanItemContainer.style.display === 'block';
        if (isScanUIVisible && scanMode === 'grocery') {
            scanItemContainer.style.display = 'none';
            stopCamera();
        } else {
            openCameraFor('grocery', groceryScanUIPlaceholder);
        }
    });

    showScanReceiptGroceryBtn.addEventListener('click', () => {
        const isVisible = groceryScanUIPlaceholder.contains(scanItemContainer) && scanItemContainer.style.display === 'block';
        if (isVisible && scanMode === 'groceryReceipt') {
            scanItemContainer.style.display = 'none';
            stopCamera();
        } else {
            openCameraFor('groceryReceipt', groceryScanUIPlaceholder);
        }
    });

    generateGroceryListBtn.addEventListener('click', generateAutomatedGroceryList);
    prevWeekBtn.addEventListener('click', () => navigateWeek('prev'));
    nextWeekBtn.addEventListener('click', () => navigateWeek('next'));
    showIdeasTab.addEventListener('click', () => {
        ideasContent.style.display = 'block';
        recipeResultsDiv.style.display = 'flex';
        favoriteRecipesList.style.display = 'none';
        showIdeasTab.classList.add('active');
        showFavoritesTab.classList.remove('active');
    });
    showFavoritesTab.addEventListener('click', () => {
        ideasContent.style.display = 'none';
        recipeResultsDiv.style.display = 'none';
        favoriteRecipesList.style.display = 'flex';
        showFavoritesTab.classList.add('active');
        showIdeasTab.classList.remove('active');
    });
    mealPlannerGrid.addEventListener('click', (event) => {
        handleMealSlotClick(event);
        handlePlanSingleDayClick(event);
    });
    modalCloseBtn.addEventListener('click', () => { mealPlanModal.style.display = 'none'; });
    modalRecipeList.addEventListener('click', handleModalClick);
    addToPlanModalCloseBtn.addEventListener('click', () => { addToPlanModal.style.display = 'none'; });
    
    addToPlanForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const meal = document.getElementById('meal-select').value;
        if (currentRecipeToPlan && selectedDates.length > 0 && meal) {
            for (const dateString of selectedDates) {
                await addRecipeToPlan(new Date(dateString), meal, currentRecipeToPlan);
            }
            
            currentDate = new Date(selectedDates[0]);

            addToPlanModal.style.display = 'none';
            currentRecipeToPlan = null;
            selectedDates = [];
            alert('Recipe added to selected dates!');
            updateWeekView(); 
        } else {
            alert('Please select at least one date.');
        }
    });

    planMyWeekBtn.addEventListener('click', handlePlanMyWeek);
    window.addEventListener('click', (event) => {
        if (event.target == mealPlanModal || event.target == addToPlanModal || event.target == createHouseholdModal || event.target == howToModal || event.target == feedbackModal) {
            mealPlanModal.style.display = 'none';
            addToPlanModal.style.display = 'none';
            createHouseholdModal.style.display = 'none';
            howToModal.style.display = 'none';
            feedbackModal.style.display = 'none';
        }
    });

    document.querySelector('.toggle-switch').addEventListener('change', (event) => {
        if (event.target.name === 'unitSystem') {
            unitSystem = event.target.value;
        }
    });

    calendarPrevMonthBtn.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() - 1);
        renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
    });
    calendarNextMonthBtn.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() + 1);
        renderAddToPlanCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
    });
    calendarGrid.addEventListener('click', (event) => {
        const dayEl = event.target.closest('.calendar-day');
        if (dayEl && !dayEl.classList.contains('other-month')) {
            const date = dayEl.dataset.date;
            const index = selectedDates.indexOf(date);
            if (index > -1) {
                selectedDates.splice(index, 1); // Deselect
                dayEl.classList.remove('selected');
            } else {
                selectedDates.push(date); // Select
                dayEl.classList.add('selected');
            }
        }
    });
    
    askTheChefForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const queryInput = document.getElementById('chef-query-input');
        const mealQuery = queryInput.value.trim();
        if (!mealQuery) {
            alert('Please enter a meal to ask the chef!');
            return;
        }

        showLoadingState(`Your Chef is creating a "${mealQuery}" recipe...`);
        try {
            const askTheChefFunc = httpsCallable(functions, 'askTheChef');
            const result = await askTheChefFunc({ mealQuery, unitSystem });
            displayRecipeResults([result.data], 'your custom'); // Display as an array of one
            queryInput.value = '';
        } catch (error) {
            console.error("Error asking the chef:", error);
            recipeResultsDiv.innerHTML = `<p>Sorry, the chef couldn't find a recipe for that. Please try being more specific or check for typos.</p>`;
        }
    });

    upgradeBtnHeader.addEventListener('click', async () => {
        try {
            const createStripeCheckout = httpsCallable(functions, 'createStripeCheckout');
            
            // Call the function without arguments.
            const result = await createStripeCheckout();
    
            // Add a check to ensure the response is valid before using it.
            if (result && result.data && result.data.id) {
                const { id } = result.data;
                await stripe.redirectToCheckout({ sessionId: id });
            } else {
                // If the response is invalid, throw an error to be caught below.
                console.error("Invalid response from createStripeCheckout function:", result);
                throw new Error("The server returned an invalid response.");
            }
    
        } catch (error) {
            console.error("Error redirecting to Stripe Checkout:", error);
            alert("Could not initiate payment. Please try again.");
        }
    });

    expandAllBtn.addEventListener('click', () => handleExpandCollapseAll(true));
    collapseAllBtn.addEventListener('click', () => handleExpandCollapseAll(false));
    expandAllGroceryBtn.addEventListener('click', () => handleExpandCollapseAllGrocery(true));
    collapseAllGroceryBtn.addEventListener('click', () => handleExpandCollapseAllGrocery(false));


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

    // How-To Modal Listeners
    howToNextBtn.addEventListener('click', () => {
        if (currentHowToSlide < howToSlides.length - 1) {
            currentHowToSlide++;
            updateHowToSlider();
        }
    });

    howToPrevBtn.addEventListener('click', () => {
        if (currentHowToSlide > 0) {
            currentHowToSlide--;
            updateHowToSlider();
        }
    });

    howToCloseBtn.addEventListener('click', () => {
        howToModal.style.display = 'none';
        markHowToAsSeen();
    });

    // Feedback Modal Listeners
    feedbackBtn.addEventListener('click', () => {
        feedbackModal.style.display = 'block';
    });

    feedbackModalCloseBtn.addEventListener('click', () => {
        feedbackModal.style.display = 'none';
    });

    feedbackForm.addEventListener('submit', async (e) => {
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
                feedbackModal.style.display = 'none';
                alert('Thank you for your feedback!');
            } catch (error) {
                console.error("Error submitting feedback:", error);
                alert('Sorry, there was an issue submitting your feedback. Please try again.');
            }
        }
    });
});