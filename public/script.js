// Import all necessary functions from the Firebase SDKs at the top
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
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

// --- GLOBAL VARIABLES ---
let currentUser = null, householdId = null, stream = null, isInEditMode = false, scanMode = 'pantry', currentDate = new Date(), unsubscribeMealPlan = () => {};
const PANTRY_CATEGORIES = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry Staples", "Frozen", "Other"];

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
const editPantryBtn = document.getElementById('edit-pantry-btn');
const bulkEditControls = document.getElementById('bulk-edit-controls');
const deleteSelectedBtn = document.getElementById('delete-selected-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const expandAllBtn = document.getElementById('expand-all-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');
const showManualAddBtn = document.getElementById('show-manual-add-btn');
const showScanItemBtn = document.getElementById('show-scan-item-btn');
const addItemContainer = document.getElementById('add-item-container');
const manualAddContainer = document.getElementById('manual-add-container');
const scanItemContainer = document.getElementById('scan-item-container');
const confirmationSection = document.getElementById('confirmation-section');
const addGroceryItemForm = document.getElementById('add-grocery-item-form');
const groceryList = document.getElementById('grocery-list');
const moveToPantryBtn = document.getElementById('move-to-pantry-btn');
const showAddGroceryFormBtn = document.getElementById('show-add-grocery-form-btn');
const showScanGroceryBtn = document.getElementById('show-scan-grocery-btn');
const moveToPantryFormContainer = document.getElementById('move-to-pantry-form-container');
const moveToPantryForm = document.getElementById('move-to-pantry-form');
const confirmMoveBtn = document.getElementById('confirm-move-btn');
const groceryScanUIPlaceholder = document.getElementById('grocery-scan-ui-placeholder');
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

// --- HELPER FUNCTIONS ---

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

function getMealPlanRef() {
    if (!householdId) return null;
    const weekId = getWeekId(currentDate);
    return doc(db, 'households', householdId, 'mealPlan', weekId);
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

async function displayPantryItems() {
    const pantryRef = getPantryRef();
    if (!pantryRef) return;
    pantryListDiv.innerHTML = '<li>Loading pantry...</li>';
    const snapshot = await getDocs(pantryRef);
    if (snapshot.empty) {
        pantryListDiv.innerHTML = '<li>Your household pantry is empty!</li>';
        editPantryBtn.style.display = 'none';
        return;
    }
    if (!isInEditMode) {
        editPantryBtn.style.display = 'block';
    }
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
                const itemText = `<span class="pantry-item-text">${item.name} (${item.quantity} ${item.unit})</span>`;
                const interactiveElement = isInEditMode
                    ? `<input type="checkbox" class="pantry-item-checkbox" data-id="${item.id}">`
                    : '';
                listItem.innerHTML = `${itemText}${interactiveElement}`;
                list.appendChild(listItem);
            });
            pantryListDiv.appendChild(list);
        }
    });
}

function updateWeekView() {
    displayWeekRange();
    displayMealPlan();
}

async function displayGroceryList() {
    const groceryRef = getGroceryListRef();
    if (!groceryRef) return;
    const q = query(groceryRef, orderBy("createdAt"));
    const snapshot = await getDocs(q);
    groceryList.innerHTML = '';
    if (snapshot.empty) {
        groceryList.innerHTML = '<li>Your grocery list is empty!</li>';
    } else {
        snapshot.forEach(doc => {
            const item = doc.data();
            const li = document.createElement('li');
            li.className = `grocery-item ${item.checked ? 'checked' : ''}`;
            li.innerHTML = `
                <div class="item-info">
                    <input type="checkbox" data-id="${doc.id}" ${item.checked ? 'checked' : ''}>
                    <label>${item.name}<span class="grocery-item-category">(${item.category || 'Other'})</span></label>
                </div>
                <button class="delete-grocery-btn danger" data-id="${doc.id}">X</button>
            `;
            groceryList.appendChild(li);
        });
    }
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
        const recipe = doc.data();
        const recipeCard = document.createElement('div');
        recipeCard.className = 'recipe-card';
        recipeCard.draggable = true;
        recipeCard.dataset.id = doc.id;
        let ingredientsHTML = '<ul>';
        if(recipe.ingredients) {
            recipe.ingredients.forEach(ing => {
                let ingredientText, ingredientName, ingredientCategory = 'Other';
                if (typeof ing === 'object' && ing !== null && ing.name) {
                    ingredientText = `${ing.quantity || ''} ${ing.unit || ''} ${ing.name}`.trim();
                    ingredientName = ing.name;
                    ingredientCategory = ing.category || 'Other';
                } else {
                    ingredientText = ing;
                    ingredientName = String(ing).replace(/^[0-9.\s/]+(lbs?|oz|g|kg|cups?|tsps?|tbsps?)?\s*/i, '').trim();
                }
                ingredientsHTML += `<li>${ingredientText} <button class="add-to-list-btn secondary" data-item-name="${ingredientName}" data-item-category="${ingredientCategory}">+ List</button></li>`;
            });
        }
        ingredientsHTML += '</ul>';
        const googleSearchQuery = encodeURIComponent(`${recipe.title} recipe`);
        const googleSearchUrl = `https://www.google.com/search?q=${googleSearchQuery}`;
        recipeCard.innerHTML = `
            <div class="recipe-card-header">
                <h3><a href="${googleSearchUrl}" target="_blank" title="Search for this recipe">${recipe.title} 🔗</a></h3>
                <button class="save-recipe-btn" title="Remove from Favorites">❌</button>
            </div>
            <p>${recipe.description}</p>
            <strong>Ingredients Used:</strong>
            ${ingredientsHTML}
        `;
        const recipeDataForStorage = { id: doc.id, title: recipe.title, description: recipe.description, ingredients: recipe.ingredients };
        recipeCard.dataset.recipe = JSON.stringify(recipeDataForStorage);
        recipeCard.addEventListener('dragstart', handleDragStart);
        favoriteRecipesList.appendChild(recipeCard);
    });
}

function displayWeekRange() {
    const startOfWeek = new Date(currentDate);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    weekRangeDisplay.textContent = `${startOfWeek.toLocaleDateString()} - ${endOfWeek.toLocaleDateString()}`;
}

function renderMealPlanner() {
    mealPlannerGrid.innerHTML = '';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mealTimes = ['Breakfast', 'Lunch', 'Dinner'];
    mealPlannerGrid.appendChild(document.createElement('div'));
    days.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'grid-cell day-header';
        dayHeader.textContent = day;
        mealPlannerGrid.appendChild(dayHeader);
    });
    mealTimes.forEach(meal => {
        const timeLabel = document.createElement('div');
        timeLabel.className = 'grid-cell time-label';
        timeLabel.textContent = meal;
        mealPlannerGrid.appendChild(timeLabel);
        days.forEach(day => {
            const mealSlot = document.createElement('div');
            mealSlot.className = 'grid-cell meal-slot';
            mealSlot.dataset.day = day.toLowerCase();
            mealSlot.dataset.meal = meal.toLowerCase();
            mealSlot.addEventListener('dragover', handleDragOver);
            mealSlot.addEventListener('dragleave', handleDragLeave);
            mealSlot.addEventListener('drop', handleDrop);
            mealPlannerGrid.appendChild(mealSlot);
        });
    });
}

async function displayMealPlan() {
    renderMealPlanner();
    const mealPlanRef = getMealPlanRef();
    if (!mealPlanRef) return;

    unsubscribeMealPlan();
    unsubscribeMealPlan = onSnapshot(mealPlanRef, (doc) => {
        if (doc.exists()) {
            const plan = doc.data();
            const meals = plan.meals || {}; 

            document.querySelectorAll('.meal-slot').forEach(slot => {
                slot.innerHTML = ''; 
                const day = slot.dataset.day;
                const meal = slot.dataset.meal;
                
                if (meals[day] && meals[day][meal]) {
                    Object.values(meals[day][meal]).forEach(recipe => {
                        const recipeDiv = document.createElement('div');
                        recipeDiv.className = 'recipe-title';
                        recipeDiv.textContent = recipe.title;
                        slot.appendChild(recipeDiv);
                    });
                }
            });
        } else {
            renderMealPlanner(); 
        }
    });
}

function handleDragStart(event) {
    event.dataTransfer.setData('application/json', event.target.dataset.recipe);
    event.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(event) {
    event.preventDefault();
    event.target.closest('.meal-slot').classList.add('drag-over');
}

function handleDragLeave(event) {
    event.target.closest('.meal-slot').classList.remove('drag-over');
}

async function handleDrop(event) {
    event.preventDefault();
    const slot = event.target.closest('.meal-slot');
    slot.classList.remove('drag-over');
    const recipeDataString = event.dataTransfer.getData('application/json');
    if (!recipeDataString) return;
    const recipe = JSON.parse(recipeDataString);
    const day = slot.dataset.day;
    const meal = slot.dataset.meal;
    await addRecipeToPlan(day, meal, recipe);
}

async function addRecipeToPlan(day, meal, recipe) {
    const mealPlanRef = getMealPlanRef();
    if (!mealPlanRef) return;
    const mealEntryId = `meal_${Date.now()}`;
    
    // This is the corrected path to match the reading logic
    const updatePath = `meals.${day}.${meal}.${mealEntryId}`;
    
    // Using updateDoc is safer as it won't overwrite the whole document
    // It will create the nested fields if they don't exist.
    await updateDoc(mealPlanRef, {
        [updatePath]: recipe
    }).catch(async (error) => {
        // If update fails because the document doesn't exist, create it with setDoc
        if (error.code === 'not-found') {
            await setDoc(mealPlanRef, {
                [updatePath]: recipe
            });
        } else {
            console.error("Error adding recipe to plan:", error);
        }
    });
}


function handleGroceryItemCheck() {
    const checkedItems = groceryList.querySelectorAll('input[type="checkbox"]:checked');
    moveToPantryBtn.style.display = checkedItems.length > 0 ? 'block' : 'none';
    groceryList.querySelectorAll('.grocery-item').forEach(li => {
        const checkbox = li.querySelector('input');
        if (checkbox && checkbox.checked) {
            li.classList.add('checked');
        } else {
            li.classList.remove('checked');
        }
    });
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
                const newItemRef = doc(pantryRef);
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
    recipeResultsDiv.innerHTML = "<p>🤖 Asking the chef for ideas...</p>";
    const pantryRef = getPantryRef();
    if (!pantryRef) {
        recipeResultsDiv.innerHTML = "<p>Error: Not in a household.</p>";
        return;
    }
    const snapshot = await getDocs(pantryRef);
    const pantryItems = snapshot.docs.map(doc => doc.data().name);
    if (pantryItems.length === 0) {
        recipeResultsDiv.innerHTML = "<p>Your pantry is empty.</p>";
        return;
    }
    await generateRecipes(pantryItems);
}

async function discoverNewRecipes() {
    recipeResultsDiv.innerHTML = "<p>🤖 Searching for new recipe ideas...</p>";
    const selectedMealType = document.querySelector('input[name="mealType"]:checked').value;
    try {
        const discoverRecipesFunc = httpsCallable(functions, 'discoverRecipes');
        const result = await discoverRecipesFunc({ mealType: selectedMealType });
        displayRecipeResults(result.data, selectedMealType);
    } catch (error) {
        console.error("Error discovering recipes:", error);
        recipeResultsDiv.innerHTML = "<p>Sorry, couldn't get new recipe ideas.</p>";
    }
}

async function generateRecipes(items) {
    const selectedMealType = document.querySelector('input[name="mealType"]:checked').value;
    try {
        const suggestRecipesFunc = httpsCallable(functions, 'suggestRecipes');
        const result = await suggestRecipesFunc({ pantryItems: items, mealType: selectedMealType });
        displayRecipeResults(result.data, selectedMealType);
    } catch (error) {
        console.error("Error getting recipes:", error);
        recipeResultsDiv.innerHTML = "<p>Sorry, couldn't get recipe suggestions.</p>";
    }
}

function displayRecipeResults(recipes, mealType) {
    recipeResultsDiv.innerHTML = "";
    if (!recipes || recipes.length === 0) {
        recipeResultsDiv.innerHTML = `<p>The AI couldn't think of any ${mealType} recipes.</p>`;
        return;
    }
    recipes.forEach(recipe => {
        const recipeCard = document.createElement('div');
        recipeCard.className = 'recipe-card';
        recipeCard.draggable = true;

        let ingredientsHTML = '<ul>';
        if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
            recipe.ingredients.forEach(ing => {
                let ingredientText, ingredientName, ingredientCategory = 'Other';
                if (typeof ing === 'object' && ing !== null && ing.name) {
                    ingredientText = `${ing.quantity || ''} ${ing.unit || ''} ${ing.name}`.trim();
                    ingredientName = ing.name;
                    ingredientCategory = ing.category || 'Other';
                } else {
                    ingredientText = ing;
                    ingredientName = String(ing).replace(/^[0-9.\s/]+(lbs?|oz|g|kg|cups?|tsps?|tbsps?)?\s*/i, '').trim();
                }
                ingredientsHTML += `<li>${ingredientText} <button class="add-to-list-btn secondary" data-item-name="${ingredientName}" data-item-category="${ingredientCategory}">+ List</button></li>`;
            });
        }
        ingredientsHTML += '</ul>';

        const recipeDataForStorage = { id: null, title: recipe.title, description: recipe.description, ingredients: recipe.ingredients };
        recipeCard.dataset.recipe = JSON.stringify(recipeDataForStorage);

        const googleSearchQuery = encodeURIComponent(`${recipe.title} recipe`);
        const googleSearchUrl = `https://www.google.com/search?q=${googleSearchQuery}`;
        recipeCard.innerHTML = `
            <div class="recipe-card-header">
                <h3><a href="${googleSearchUrl}" target="_blank" title="Search for this recipe">${recipe.title} 🔗</a></h3>
                <button class="save-recipe-btn" title="Save to Favorites">⭐</button>
            </div>
            <p>${recipe.description}</p>
            <strong>Ingredients Used:</strong>
            ${ingredientsHTML}`;
        
        recipeCard.addEventListener('dragstart', handleDragStart);
        recipeResultsDiv.appendChild(recipeCard);
    });
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
    if (scanMode === 'quickMeal') {
        targetContainer = recipeResultsDiv;
        targetContainer.innerHTML = '<p>🤖 Scanning for ingredients and getting recipes...</p>';
        addItemContainer.style.display = 'none';
    } else {
        targetContainer = itemConfirmationList;
        confirmationSection.style.display = 'block';
        targetContainer.innerHTML = '<p>🧠 Thinking... please wait.</p>';
    }

    try {
        const identifyItemsFunc = httpsCallable(functions, 'identifyItems');
        const result = await identifyItemsFunc({ image: base64ImageData });
        const identifiedItems = result.data;
        
        switch (scanMode) {
            case 'quickMeal':
                const itemNames = identifiedItems.map(item => item.name);
                await generateRecipes(itemNames);
                break;
            case 'grocery':
                const groceryRef = getGroceryListRef();
                if (!groceryRef) return;
                const batch = writeBatch(db);
                identifiedItems.forEach(item => {
                    const newItemRef = doc(groceryRef);
                    batch.set(newItemRef, { name: item.name.toLowerCase(), category: item.category, checked: false, createdAt: serverTimestamp() });
                });
                await batch.commit();
                displayGroceryList();
                addItemContainer.style.display = 'none';
                break;
            case 'pantry':
            default:
                displayConfirmationForm(identifiedItems);
                break;
        }
    } catch (error) {
        console.error('Error calling Vision API:', error);
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
            <button class="remove-item-btn danger">X</button>
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
    if (event.target.type === 'checkbox') {
        handleGroceryItemCheck();
    }
    if (event.target.classList.contains('delete-grocery-btn')) {
        const itemId = event.target.dataset.id;
        const groceryRef = getGroceryListRef();
        if (groceryRef && itemId) {
            if (confirm("Are you sure you want to remove this item from your grocery list?")) {
                await deleteDoc(doc(groceryRef, itemId));
                displayGroceryList();
            }
        }
    }
}

async function handleMoveToPantry() {
    const checkedItems = groceryList.querySelectorAll('input[type="checkbox"]:checked');
    if (checkedItems.length === 0) return;
    const groceryRef = getGroceryListRef();

    moveToPantryForm.innerHTML = '';
    
    const itemDocsPromises = Array.from(checkedItems).map(checkbox => getDoc(doc(groceryRef, checkbox.dataset.id)));
    const itemDocs = await Promise.all(itemDocsPromises);

    itemDocs.forEach((doc, index) => {
        if (!doc.exists) return;
        const item = doc.data();
        const itemDiv = document.createElement('div');
        itemDiv.className = 'form-grid';
        itemDiv.innerHTML = `
            <input type="hidden" class="grocery-item-id" value="${doc.id}">
            <input type="text" value="${item.name}" class="item-name" readonly>
            <input type="number" value="1" class="item-quantity">
            <input type="text" value="units" class="item-unit">
            <select class="item-category" id="move-category-${index}"></select>
        `;
        moveToPantryForm.appendChild(itemDiv);
        const categorySelect = document.getElementById(`move-category-${index}`);
        populateCategoryDropdown(categorySelect);
        if (item.category && PANTRY_CATEGORIES.includes(item.category)) {
            categorySelect.value = item.category;
        }
    });
    moveToPantryFormContainer.style.display = 'block';
}

async function handleConfirmMoveToPantry() {
    const pantryRef = getPantryRef();
    const groceryRef = getGroceryListRef();
    if (!pantryRef || !groceryRef) return;

    const itemsToMove = moveToPantryForm.querySelectorAll('.form-grid');
    const batch = writeBatch(db);

    itemsToMove.forEach((formRow) => {
        const name = formRow.querySelector('.item-name').value;
        const quantity = parseFloat(formRow.querySelector('.item-quantity').value);
        const unit = formRow.querySelector('.item-unit').value;
        const category = formRow.querySelector('.item-category').value;
        const groceryItemId = formRow.querySelector('.grocery-item-id').value;
        
        if (name && quantity && unit && category) {
            const newPantryItemRef = doc(pantryRef);
            batch.set(newPantryItemRef, { name, quantity, unit, category, addedBy: currentUser.email });
            
            const groceryItemRef = doc(groceryRef, groceryItemId);
            batch.delete(groceryItemRef);
        }
    });

    await batch.commit();
    moveToPantryFormContainer.style.display = 'none';
    displayPantryItems();
    displayGroceryList();
}

async function handleAddFromRecipe(event) {
    const itemName = event.target.dataset.itemName;
    const itemCategory = event.target.dataset.itemCategory || 'Other';
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

async function handleSaveRecipe(event) {
    const card = event.target.closest('.recipe-card');
    const recipeData = JSON.parse(card.dataset.recipe);
    const favoritesRef = getFavoritesRef();
    if (favoritesRef && recipeData) {
        await addDoc(favoritesRef, recipeData);
        alert(`"${recipeData.title}" saved to favorites!`);
        displayFavoriteRecipes();
    }
}

async function handleDeleteFavorite(event) {
    const card = event.target.closest('.recipe-card');
    const recipeId = card.dataset.id;
    const favoritesRef = getFavoritesRef();
    if (favoritesRef && recipeId) {
        if (confirm("Are you sure you want to remove this recipe from your favorites?")) {
            await deleteDoc(doc(favoritesRef, recipeId));
            displayFavoriteRecipes();
        }
    }
}

function handleRecipeCardClick(event) {
    if (event.target.classList.contains('add-to-list-btn')) {
        handleAddFromRecipe(event);
    } else if (event.target.classList.contains('save-recipe-btn')) {
        handleSaveRecipe(event);
    }
}

function handleFavoriteCardClick(event) {
    if (event.target.classList.contains('add-to-list-btn')) {
        handleAddFromRecipe(event);
    } else if (event.target.classList.contains('save-recipe-btn')) {
        handleDeleteFavorite(event);
    }
}

async function handleMealSlotClick(event) {
    const slot = event.target.closest('.meal-slot');
    if (!slot || !slot.querySelector('.recipe-title')) return;

    const day = slot.dataset.day;
    const meal = slot.dataset.meal;
    const mealPlanRef = getMealPlanRef();
    const docSnap = await getDoc(mealPlanRef);

    if (docSnap.exists()) {
        const plan = docSnap.data();
        const mealsForSlot = plan.meals?.[day]?.[meal];
        if (mealsForSlot) {
            modalRecipeList.innerHTML = '';
            modalSlotTitle.textContent = `${day.charAt(0).toUpperCase() + day.slice(1)} ${meal.charAt(0).toUpperCase() + meal.slice(1)}`;
            Object.entries(mealsForSlot).forEach(([mealEntryId, recipe]) => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'modal-recipe-item';
                itemDiv.innerHTML = `
                    <h4>${recipe.title}</h4>
                    <button class="remove-from-plan-btn danger" data-day="${day}" data-meal="${meal}" data-id="${mealEntryId}">Remove</button>
                `;
                modalRecipeList.appendChild(itemDiv);
            });
            mealPlanModal.style.display = 'block';
        }
    }
}

async function handleRemoveFromPlanClick(event) {
    if (!event.target.classList.contains('remove-from-plan-btn')) return;

    const { day, meal, id } = event.target.dataset;
    const mealPlanRef = getMealPlanRef();
    const updatePath = `meals.${day}.${meal}.${id}`;
    
    await updateDoc(mealPlanRef, {
        [updatePath]: deleteField()
    });

    mealPlanModal.style.display = 'none';
}

function toggleEditMode() {
    isInEditMode = !isInEditMode;
    editPantryBtn.textContent = isInEditMode ? 'Done Editing' : 'Edit Pantry';
    bulkEditControls.style.display = isInEditMode ? 'flex' : 'none';
    displayPantryItems();
}

async function handleBulkDelete() {
    const pantryRef = getPantryRef();
    if (!pantryRef) return;
    const checkedItems = pantryListDiv.querySelectorAll('.pantry-item-checkbox:checked');
    if (checkedItems.length === 0) return alert("Please select items to delete.");
    if (confirm(`Are you sure you want to delete ${checkedItems.length} item(s)?`)) {
        const batch = writeBatch(db);
        checkedItems.forEach(checkbox => batch.delete(doc(pantryRef, checkbox.dataset.id)));
        await batch.commit();
        toggleEditMode();
    }
}

function handleExpandCollapseAll(expand) {
    const allLists = pantryListDiv.querySelectorAll('ul');
    const allToggles = pantryListDiv.querySelectorAll('.category-toggle');
    allLists.forEach(list => list.style.display = expand ? 'block' : 'none');
    allToggles.forEach(toggle => toggle.textContent = expand ? '−' : '+');
}

function handleRemoveConfirmedItem(event) {
    if (event.target.classList.contains('remove-item-btn')) {
        event.target.closest('.confirmation-item').remove();
    }
}

function openCameraFor(mode) {
    scanMode = mode;
    manualAddContainer.style.display = 'none';
    addGroceryItemForm.style.display = 'none';
    confirmationSection.style.display = 'none';

    if (mode === 'grocery') {
        groceryScanUIPlaceholder.appendChild(scanItemContainer);
        scanItemContainer.style.display = 'block';
        addItemContainer.style.display = 'none';
    } else {
        addItemContainer.appendChild(scanItemContainer);
        scanItemContainer.style.display = 'block';
        addItemContainer.style.display = 'block';
    }
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

// --- MAIN APP LOGIC & EVENT LISTENERS ---

// This is the single entry point to the main app logic
function startApp() {
    populateCategoryDropdown(manualCategorySelect);
    populateCategoryDropdown(groceryItemCategorySelect);
    displayPantryItems();
    updateWeekView();
    displayGroceryList();
    displayFavoriteRecipes();
    
    // Attach all event listeners for the main app
    pantryListDiv.addEventListener('click', handlePantryClick);
    manualAddForm.addEventListener('submit', handleManualAdd);
    addToPantryBtn.addEventListener('click', addItemsToPantry);
    suggestRecipeBtn.addEventListener('click', getRecipeSuggestions);
    discoverRecipesBtn.addEventListener('click', discoverNewRecipes);
    quickMealBtn.addEventListener('click', () => openCameraFor('quickMeal'));
    startCameraBtn.addEventListener('click', startCamera);
    captureBtn.addEventListener('click', captureAndScan);
    editPantryBtn.addEventListener('click', toggleEditMode);
    cancelEditBtn.addEventListener('click', toggleEditMode);
    deleteSelectedBtn.addEventListener('click', handleBulkDelete);
    expandAllBtn.addEventListener('click', () => handleExpandCollapseAll(true));
    collapseAllBtn.addEventListener('click', () => handleExpandCollapseAll(false));
    itemConfirmationList.addEventListener('click', handleRemoveConfirmedItem);
    showManualAddBtn.addEventListener('click', () => {
        const isVisible = manualAddContainer.style.display === 'block';
        addItemContainer.style.display = isVisible ? 'none' : 'block';
        manualAddContainer.style.display = isVisible ? 'none' : 'block';
        scanItemContainer.style.display = 'none';
        confirmationSection.style.display = 'none';
    });
    showScanItemBtn.addEventListener('click', () => {
        const isScanUIVisible = scanItemContainer.style.display === 'block';
        if (isScanUIVisible && scanMode === 'pantry') {
            addItemContainer.style.display = 'none';
            stopCamera();
        } else {
            openCameraFor('pantry');
        }
    });
    addGroceryItemForm.addEventListener('submit', handleAddGroceryItem);
    groceryList.addEventListener('click', handleGroceryListClick);
    moveToPantryBtn.addEventListener('click', handleMoveToPantry);
    recipeResultsDiv.addEventListener('click', handleRecipeCardClick);
    favoriteRecipesList.addEventListener('click', handleFavoriteCardClick);
    showAddGroceryFormBtn.addEventListener('click', () => {
        addGroceryItemForm.style.display = addGroceryItemForm.style.display === 'none' ? 'flex' : 'none';
    });
    showScanGroceryBtn.addEventListener('click', () => {
        const isScanUIVisible = scanItemContainer.style.display === 'block';
        if (isScanUIVisible && scanMode === 'grocery') {
            scanItemContainer.style.display = 'none';
            stopCamera();
        } else {
            openCameraFor('grocery');
        }
    });
    confirmMoveBtn.addEventListener('click', handleConfirmMoveToPantry);
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
    mealPlannerGrid.addEventListener('click', handleMealSlotClick);
    modalCloseBtn.addEventListener('click', () => { mealPlanModal.style.display = 'none'; });
    modalRecipeList.addEventListener('click', handleRemoveFromPlanClick);
    window.addEventListener('click', (event) => {
        if (event.target == mealPlanModal) {
            mealPlanModal.style.display = 'none';
        }
    });
}

// --- TOP-LEVEL EXECUTION (This code runs when the script is loaded) ---

onAuthStateChanged(auth, async user => {
    if (user) {
        currentUser = user;
        welcomeMessage.textContent = `Hello, ${user.displayName}!`;
        signInBtn.style.display = 'none';
        signOutBtn.style.display = 'block';
        welcomeMessage.style.display = 'inline';
        
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists() && userDoc.data().householdId) {
            householdId = userDoc.data().householdId;
            householdManager.style.display = 'none';
            appContent.style.display = 'block';
            householdInfo.textContent = `Household Invite Code: ${householdId}`;
            householdInfo.style.display = 'block';
            startApp(); // Changed from initializeApp to startApp
        } else {
            householdManager.style.display = 'block';
            appContent.style.display = 'none';
            householdInfo.style.display = 'none';
        }
    } else {
        currentUser = null; householdId = null; isInEditMode = false;
        signInBtn.style.display = 'block';
        signOutBtn.style.display = 'none';
        welcomeMessage.style.display = 'none';
        householdInfo.style.display = 'none';
        appContent.style.display = 'none';
        householdManager.style.display = 'none';
    }
});

signInBtn.addEventListener('click', () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).catch(error => console.error("Sign in error", error));
});

signOutBtn.addEventListener('click', () => signOut(auth));

createHouseholdBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    const newHouseholdId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const householdRef = doc(db, 'households', newHouseholdId);
    const userRef = doc(db, 'users', currentUser.uid);
    
    const batch = writeBatch(db);
    batch.set(householdRef, { owner: currentUser.uid, members: [currentUser.uid] });
    batch.set(userRef, { email: currentUser.email, householdId: newHouseholdId });
    
    await batch.commit();
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
});