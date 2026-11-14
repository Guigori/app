import { expect, test } from "@playwright/test";
import { createFirstAccount } from "./walletHelpers";

// Menu, busca global, Configurações e Meu perfil. Local mode with an empty device.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("finnos:mode", "local");
    window.localStorage.setItem("finnos:notifications-prompt-dismissed-at", String(Date.now()));
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 401, contentType: "application/json",
    body: JSON.stringify({ detail: "Não autenticado." }),
  }));
  await createFirstAccount(page, { bank: "Banco Teste", nickname: "Conta Teste", balance: "1000" });
});

test("the phone menu has the profile, Conversa and Buscar, and leaves out the bottom-bar tabs", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone drawer");
  await page.goto("/");
  await page.getByTestId("open-nav-drawer").click();
  const drawer = page.getByTestId("nav-drawer");
  await expect(drawer.getByTestId("drawer-nav-profile")).toBeVisible();
  await expect(drawer.getByTestId("drawer-nav-conversa")).toBeVisible();
  await expect(drawer.getByTestId("drawer-nav-buscar")).toBeVisible();
  // Início, Fluxo, Orçamento and Carteira are in the bar, so not in the menu.
  await expect(drawer.getByTestId("drawer-nav-orcamento")).toHaveCount(0);
  await expect(drawer.getByTestId("drawer-nav-radar")).toBeVisible();
  await expect(drawer.getByTestId("drawer-nav-analise")).toBeVisible();
  // Signing out asks first.
  await drawer.getByTestId("drawer-nav-logout").click();
  await expect(page.getByRole("alertdialog").or(page.getByRole("dialog", { name: "Sair da conta?" }))).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("Barra e menu changes the bar and hides menu items", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone bar and drawer");
  await page.goto("/configuracoes/navegacao");
  await page.getByTestId("settings-bar-remove-orcamento").click();
  await page.getByTestId("settings-bar-add-analise").click();
  await page.getByTestId("settings-menu-mobile-radar").click();
  await expect(page.getByTestId("mobile-nav-analise")).toBeVisible();
  await expect(page.getByTestId("mobile-nav-orcamento")).toHaveCount(0);
  await page.getByTestId("open-nav-drawer").click();
  const drawer = page.getByTestId("nav-drawer");
  await expect(drawer.getByTestId("drawer-nav-orcamento")).toBeVisible();
  await expect(drawer.getByTestId("drawer-nav-radar")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("settings-navigation-reset").click();
  await expect(page.getByTestId("mobile-nav-orcamento")).toBeVisible();
});

test("the global search finds an account and a setting, grouped by section", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) await page.getByTestId("header-search-button").click();
  else {
    await expect(page.getByTestId("sidebar-nav")).toBeVisible();
    await page.keyboard.press("Control+k");
  }
  const search = page.getByTestId("global-search");
  await expect(search).toBeVisible();
  await page.getByTestId("global-search-input").fill("conta teste");
  await expect(search.getByTestId("global-search-contas")).toContainText("Conta Teste");
  await page.getByTestId("global-search-input").fill("tema");
  await search.getByTestId("global-search-telas").getByText("Tema claro ou escuro").click();
  await expect(page).toHaveURL(/\/configuracoes\/aparencia$/);
  await expect(search).toBeHidden();
});

test("Meu perfil is apart from Configurações, and its Sair asks first", async ({ page }) => {
  await page.goto("/configuracoes");
  await expect(page.getByTestId("settings-hub")).toBeVisible();
  await expect(page.getByTestId("settings-theme-switch")).toBeVisible();
  await expect(page.getByTestId("settings-logout-button")).toHaveCount(0);
  await page.getByTestId("settings-profile-link").click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByTestId("profile-identity")).toBeVisible();
  await page.getByTestId("settings-logout-button").click();
  await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page).toHaveURL(/\/perfil$/);
});

test("the computer menu folds to icons and switches the theme", async ({ page, isMobile }) => {
  test.skip(isMobile, "computer sidebar");
  await page.goto("/");
  const nav = page.getByTestId("sidebar-nav");
  await expect(nav.getByTestId("sidebar-inicio")).toBeVisible();
  await expect(nav.getByTestId("sidebar-orcamento")).toBeVisible();
  await page.getByTestId("theme-toggle-button").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByTestId("sidebar-toggle").click();
  await expect(nav.getByTestId("sidebar-inicio")).toHaveAttribute("aria-label", "Início");
});
