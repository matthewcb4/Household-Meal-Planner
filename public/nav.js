document.addEventListener('DOMContentLoaded', () => {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mainHeader = document.querySelector('.main-header');
    const navMenuContent = document.querySelector('.nav-menu-content');

    // Toggles the menu when the hamburger button is clicked
    if (mobileMenuBtn && mainHeader) {
        mobileMenuBtn.addEventListener('click', (event) => {
            // Stop the click from propagating to other elements, just in case.
            event.stopPropagation();
            mainHeader.classList.toggle('open');
        });
    }

    // Closes the menu automatically when any link inside it is clicked
    if (navMenuContent) {
        navMenuContent.addEventListener('click', (e) => {
            if (e.target.tagName === 'A') {
                mainHeader.classList.remove('open');
            }
        });
    }
});

