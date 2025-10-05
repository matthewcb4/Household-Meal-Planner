from playwright.sync_api import sync_playwright, Page, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # Navigate to the app page
        page.goto("http://localhost:8080/app.html", wait_until="domcontentloaded")

        # Wait for a known element to be present before proceeding
        page.wait_for_selector("#app-container", timeout=10000)

        # The app content is hidden until the user is "logged in".
        # We can force it to be visible for the test.
        page.evaluate("document.getElementById('app-content').style.display = 'block'")
        page.evaluate("document.querySelector('.sidebar-nav a[data-target=\"recipe-section\"]').click()")

        # Find the "Ask the Chef" section
        ask_the_chef_section = page.locator("#ask-the-chef-section")
        expect(ask_the_chef_section).to_be_visible()

        # Find the new dropdown within that section
        prioritize_equipment_dropdown = ask_the_chef_section.locator("#prioritize-equipment-select")

        # Assert that the dropdown is visible
        expect(prioritize_equipment_dropdown).to_be_visible()

        # Take a screenshot of the "Ask the Chef" section to verify
        ask_the_chef_section.screenshot(path="jules-scratch/verification/verification.png")
        print("Screenshot taken successfully.")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)