import type { Locator, Page } from '@playwright/test'

export async function selectListOption(page: Page, control: Locator, value: string) {
  const trigger = control.and(page.getByRole('combobox'))
  const panelId = await trigger.getAttribute('aria-controls')
  await trigger.click()
  await page.locator(`[id="${panelId}"]`).locator('[role="option"]').and(page.locator(`[data-value="${value}"]`)).click()
}
