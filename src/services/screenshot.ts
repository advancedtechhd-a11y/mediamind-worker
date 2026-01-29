// Screenshot Service
// Takes screenshots of web pages using Playwright

import { chromium, Browser, Page } from 'playwright';

let browser: Browser | null = null;

// ============================================
// INITIALIZE BROWSER
// ============================================

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

// ============================================
// TAKE SCREENSHOT
// ============================================

export async function takeScreenshot(
  url: string,
  outputPath: string,
  options: {
    width?: number;
    height?: number;
    fullPage?: boolean;
    timeout?: number;
  } = {}
): Promise<boolean> {
  const {
    width = 1280,
    height = 800,
    fullPage = false,
    timeout = 30000,
  } = options;

  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Set viewport
    await page.setViewportSize({ width, height });

    // Set user agent
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    // Navigate to page
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    // Try to dismiss cookie banners and popups
    await dismissPopups(page);

    // Wait a bit for any animations to settle
    await page.waitForTimeout(1000);

    // Take screenshot
    await page.screenshot({
      path: outputPath,
      fullPage,
      type: 'png',
    });

    return true;

  } catch (error: any) {
    console.error(`      Screenshot failed for ${url}: ${error.message}`);
    return false;
  } finally {
    if (page) {
      await page.close();
    }
  }
}

// ============================================
// DISMISS POPUPS/COOKIE BANNERS
// ============================================

async function dismissPopups(page: Page): Promise<void> {
  const dismissSelectors = [
    // Cookie consent buttons
    '[class*="cookie"] button[class*="accept"]',
    '[class*="cookie"] button[class*="agree"]',
    '[class*="consent"] button[class*="accept"]',
    'button[id*="accept-cookies"]',
    'button[id*="cookie-accept"]',
    '[class*="gdpr"] button',
    // Generic close buttons
    '[class*="modal"] button[class*="close"]',
    '[class*="popup"] button[class*="close"]',
    '[aria-label="Close"]',
    '[aria-label="Dismiss"]',
    // Newsletter popups
    '[class*="newsletter"] button[class*="close"]',
    '[class*="subscribe"] button[class*="close"]',
  ];

  for (const selector of dismissSelectors) {
    try {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        await page.waitForTimeout(500);
      }
    } catch (e) {
      // Ignore errors - button might not exist or be clickable
    }
  }
}

// ============================================
// CLEANUP
// ============================================

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// Cleanup on process exit
process.on('exit', () => {
  if (browser) {
    browser.close();
  }
});
