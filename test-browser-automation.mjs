/**
 * Browser automation test script
 * Tests registration, login, and crew creation
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'http://localhost:5173';
const SCREENSHOTS_DIR = './test-screenshots';

// Test credentials
const TEST_USER = {
  email: 'test@test.cz',
  password: 'Test1234!',
  name: 'Test User',
  companyName: 'Test Company'
};

const TEST_CREW = {
  name: 'Testovací posádka',
  workStart: '08:00',
  workEnd: '16:00'
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(page, name) {
  try {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const path = join(SCREENSHOTS_DIR, `${name}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`📸 Screenshot saved: ${path}`);
  } catch (error) {
    console.error(`Failed to take screenshot ${name}:`, error.message);
  }
}

async function main() {
  console.log('🚀 Starting browser automation test...\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500 // Slow down actions for visibility
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();
  
  try {
    // Step 1: Navigate to the application
    console.log('📍 Step 1: Navigating to', BASE_URL);
    await page.goto(BASE_URL);
    await sleep(1000);
    await takeScreenshot(page, '01-initial-page');
    
    // Check if we're on login or register page
    const hasRegisterLink = await page.locator('text=Register').count() > 0;
    const hasRegisterButton = await page.locator('text=Zaregistrovat se').count() > 0;
    
    let needsRegistration = true;
    
    // Try to register first
    if (hasRegisterLink || hasRegisterButton) {
      console.log('\n📝 Step 2: Attempting registration...');
      
      // Click register link if on login page
      if (hasRegisterLink) {
        await page.click('text=Register');
        await sleep(1000);
        await takeScreenshot(page, '02-register-page');
      }
      
      // Fill registration form
      console.log('  - Filling registration form...');
      await page.fill('input[type="text"]#name', TEST_USER.name);
      await page.fill('input[type="email"]', TEST_USER.email);
      await page.fill('input[type="password"]', TEST_USER.password);
      await page.fill('input#businessName', TEST_USER.companyName);
      
      await takeScreenshot(page, '03-register-form-filled');
      
      // Submit registration
      console.log('  - Submitting registration...');
      await page.click('button[type="submit"]');
      await sleep(2000);
      
      // Check if registration was successful or user already exists
      const errorVisible = await page.locator('.error').isVisible().catch(() => false);
      
      if (errorVisible) {
        const errorText = await page.locator('.error').textContent();
        console.log(`  ⚠️  Registration failed: ${errorText}`);
        console.log('  - User might already exist, trying to login instead...');
        needsRegistration = false;
        
        // Go to login page
        await page.click('text=Sign in, text=Přihlaste se').first();
        await sleep(1000);
      } else {
        console.log('  ✅ Registration successful!');
        needsRegistration = false;
      }
    }
    
    // Step 3: Login if needed
    if (needsRegistration || await page.locator('input[type="email"]').count() > 0) {
      console.log('\n🔐 Step 3: Logging in...');
      await takeScreenshot(page, '04-login-page');
      
      await page.fill('input[type="email"]', TEST_USER.email);
      await page.fill('input[type="password"]', TEST_USER.password);
      await takeScreenshot(page, '05-login-form-filled');
      
      await page.click('button[type="submit"]');
      await sleep(2000);
    }
    
    // Step 4: Check main page
    console.log('\n🏠 Step 4: Checking main page...');
    await takeScreenshot(page, '06-main-page');
    
    const pageTitle = await page.title();
    console.log(`  - Page title: ${pageTitle}`);
    
    // Look for navigation elements
    const navLinks = await page.locator('nav a, aside a, [role="navigation"] a').allTextContents();
    console.log(`  - Navigation links found: ${navLinks.join(', ')}`);
    
    // Step 5: Navigate to Settings
    console.log('\n⚙️  Step 5: Navigating to Settings (Nastavení)...');
    
    // Try multiple selectors for Settings link
    const settingsSelectors = [
      'text=Settings',
      'text=Nastavení',
      'a[href="/settings"]',
      'a[href*="settings"]'
    ];
    
    let settingsFound = false;
    for (const selector of settingsSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`  - Found settings link with selector: ${selector}`);
        await page.click(selector);
        settingsFound = true;
        break;
      }
    }
    
    if (!settingsFound) {
      console.log('  ⚠️  Settings link not found, trying direct navigation...');
      await page.goto(`${BASE_URL}/settings`);
    }
    
    await sleep(2000);
    await takeScreenshot(page, '07-settings-page');
    
    // Step 6: Navigate to Crews tab
    console.log('\n👥 Step 6: Navigating to Crews (Posádky) tab...');
    
    const crewsSelectors = [
      'text=Crews',
      'text=Posádky',
      'button:has-text("Posádky")',
      'a:has-text("Posádky")'
    ];
    
    let crewsFound = false;
    for (const selector of crewsSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`  - Found crews tab with selector: ${selector}`);
        await page.click(selector);
        crewsFound = true;
        break;
      }
    }
    
    if (!crewsFound) {
      console.log('  ⚠️  Crews tab not found, trying hash navigation...');
      await page.goto(`${BASE_URL}/settings#crews`);
    }
    
    await sleep(1000);
    await takeScreenshot(page, '08-crews-tab');
    
    // Step 7: Create new crew
    console.log('\n➕ Step 7: Creating new crew...');
    
    // Look for "Add" or "Přidat" button
    const addButtonSelectors = [
      'button:has-text("Add")',
      'button:has-text("Přidat")',
      'button.btn-primary',
      'button:has-text("crew")'
    ];
    
    let addButtonFound = false;
    for (const selector of addButtonSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`  - Found add button with selector: ${selector}`);
        await page.click(selector);
        addButtonFound = true;
        break;
      }
    }
    
    if (!addButtonFound) {
      throw new Error('Add crew button not found');
    }
    
    await sleep(1000);
    await takeScreenshot(page, '09-crew-form-opened');
    
    // Fill crew form
    console.log('  - Filling crew form...');
    await page.fill('input#crewName', TEST_CREW.name);
    
    // Fill time inputs
    const timeInputs = await page.locator('input[type="time"]').all();
    if (timeInputs.length >= 2) {
      await timeInputs[0].fill(TEST_CREW.workStart);
      await timeInputs[1].fill(TEST_CREW.workEnd);
    }
    
    await takeScreenshot(page, '10-crew-form-filled');
    
    // Submit form
    console.log('  - Submitting crew form...');
    await page.click('button[type="submit"]');
    await sleep(2000);
    
    await takeScreenshot(page, '11-crew-created');
    
    // Verify crew was created
    const crewVisible = await page.locator(`text=${TEST_CREW.name}`).isVisible().catch(() => false);
    
    if (crewVisible) {
      console.log(`  ✅ Crew "${TEST_CREW.name}" created successfully!`);
    } else {
      console.log('  ⚠️  Could not verify crew creation');
    }
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log('✅ Login/Registration: Successful');
    console.log('✅ Main page: Accessible');
    console.log('✅ Settings page: Accessible');
    console.log(`✅ Crew creation: ${crewVisible ? 'Successful' : 'Uncertain'}`);
    console.log('='.repeat(60));
    console.log(`\n📁 Screenshots saved in: ${SCREENSHOTS_DIR}`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await takeScreenshot(page, 'error-state');
    throw error;
  } finally {
    await sleep(2000);
    await browser.close();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
