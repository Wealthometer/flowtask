import { expect, test, type Browser, type Page } from "@playwright/test";

const stamp = Date.now().toString(36);
let n = 0;

async function person(browser: Browser, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  const email = `${name.split(" ")[0]!.toLowerCase()}-${stamp}-${++n}@example.com`;
  await page.goto("/");
  await page.getByTestId("name").fill(name);
  await page.getByTestId("email").fill(email);
  await page.getByTestId("password").fill("correct horse");
  await page.getByTestId("submit").click();
  await expect(page).toHaveURL(/onboarding/);
  return { page, context, email };
}

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const text = (page: Page, value: string | RegExp) => page.getByText(value).filter({ visible: true });

async function makeWorkspace(page: Page, name: string) {
  await page.getByTestId("workspace-name").fill(name);
  await page.getByTestId("create-workspace").click();
  await expect(page).toHaveURL(/home/);
}

async function newProject(page: Page, name: string) {
  await page.goto("/project/new");
  await page.getByTestId("project-name").fill(name);
  await page.getByTestId("template-simple").click();
  await page.getByTestId("create-project").click();
  await expect(page).toHaveURL(/\/project\//);
}

test("a team works together: invite, assign, comment, finish, live on both phones", async ({ browser }) => {
  const ada = await person(browser, "Ada Obi");
  await makeWorkspace(ada.page, "Studio Kofi");
  // The starter project is there from the start.
  await expect(visible(ada.page, "project-Getting started")).toBeVisible();

  // Ada makes an invite code; Tunde joins with it.
  await ada.page.goto("/team");
  await ada.page.getByTestId("make-invite").click();
  const code = (await ada.page.getByTestId("invite-code-value").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{10}$/);

  const tunde = await person(browser, "Tunde Bello");
  await tunde.page.getByTestId("invite-code").fill(code.toLowerCase());
  await tunde.page.getByTestId("check-code").click();
  await expect(text(tunde.page, /Ada Obi invited you to Studio Kofi/)).toBeVisible();
  await tunde.page.getByTestId("join").click();
  await expect(tunde.page).toHaveURL(/home/);

  // Ada starts a project and gives Tunde a task due today.
  await newProject(ada.page, "Launch");
  const projectUrl = ada.page.url();
  await ada.page.goto("/new-task");
  await ada.page.getByTestId("new-task-title").fill("Write the hero copy");
  await ada.page.getByTestId("pick-project-Launch").click();
  await ada.page.getByTestId("new-assignee").click();
  await ada.page.getByTestId("assign-Tunde Bello").click();
  await ada.page.getByTestId("new-due").click();
  await ada.page.getByTestId("due-Today").click();
  await ada.page.getByTestId("add-task").click();

  // It appears on Tunde's Home without a refresh, and in his inbox.
  await expect(visible(tunde.page, "row-Write the hero copy")).toBeVisible({ timeout: 15_000 });
  await tunde.page.getByTestId("tab-inbox").click();
  await expect(text(tunde.page, "Ada assigned you “Write the hero copy”")).toBeVisible();

  // Tunde comments with a mention; Ada, watching the task, sees it arrive.
  await ada.page.goto(projectUrl);
  await visible(ada.page, "task-Write the hero copy").click();
  await expect(ada.page.getByTestId("task-title")).toHaveValue("Write the hero copy");

  await tunde.page.getByTestId("tab-home").click();
  await visible(tunde.page, "row-Write the hero copy").click();
  await tunde.page.getByTestId("comment-input").fill("First draft is in. @ada can you look?");
  await tunde.page.getByTestId("send-comment").click();
  await expect(text(ada.page, "First draft is in.")).toBeVisible({ timeout: 15_000 });

  // Tunde moves it to Done; Ada's screen follows.
  await tunde.page.getByTestId("status-Done").click();
  await expect(text(ada.page, /finished just now/)).toBeVisible({ timeout: 15_000 });

  // Ada's inbox has the mention and the finished task.
  await ada.page.goto("/inbox");
  await expect(text(ada.page, /Tunde mentioned you on “Write the hero copy”/)).toBeVisible();
  await expect(text(ada.page, "Tunde finished “Write the hero copy”")).toBeVisible();

  await ada.context.close();
  await tunde.context.close();
});

test("changes made offline are kept and sync when back online", async ({ browser }) => {
  const ada = await person(browser, "Ada Obi");
  await makeWorkspace(ada.page, "Solo");
  await newProject(ada.page, "Garden");
  const projectUrl = ada.page.url();

  // The app is open and everything has synced; now the connection drops.
  await expect(visible(ada.page, "column-To do")).toBeVisible();
  await expect.poll(() => ada.page.evaluate(() => JSON.parse(localStorage.getItem("flowtask:v1") ?? "{}").outbox?.length ?? -1)).toBe(0);
  await ada.context.setOffline(true);

  await ada.page.getByRole("button", { name: "Add a task to To do" }).click();
  await ada.page.getByTestId("new-task-title").fill("Plant tomatoes");
  await ada.page.getByTestId("add-task").click();
  await expect(visible(ada.page, "task-Plant tomatoes")).toBeVisible();
  await expect(visible(ada.page, "offline")).toContainText("1 change waiting", { timeout: 15_000 });

  // A second device sees nothing yet…
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto("/");
  await page2.getByText("I have an account").click();
  await page2.getByTestId("email").fill(ada.email);
  await page2.getByTestId("password").fill("correct horse");
  await page2.getByTestId("submit").click();
  await expect(page2).toHaveURL(/home/);
  await page2.goto(projectUrl);
  await expect(visible(page2, "column-To do")).toBeVisible();
  await expect(visible(page2, "task-Plant tomatoes")).toHaveCount(0);

  // …until the first one is back online.
  await ada.context.setOffline(false);
  await expect(visible(ada.page, "offline")).toHaveCount(0, { timeout: 70_000 });
  await expect(visible(page2, "task-Plant tomatoes")).toBeVisible({ timeout: 15_000 });

  await ada.context.close();
  await other.close();
});

test("a project's workflow can be reshaped", async ({ browser }) => {
  const ada = await person(browser, "Ada Obi");
  await makeWorkspace(ada.page, "Shapes");
  await newProject(ada.page, "Hiring");
  await ada.page.getByRole("button", { name: "Add a task to Doing" }).click();
  await ada.page.getByTestId("new-task-title").fill("Phone screen with Sam");
  await ada.page.getByTestId("add-task").click();

  await ada.page.getByTestId("project-menu").click();
  await ada.page.getByTestId("edit-columns").click();
  await ada.page.getByRole("button", { name: "Delete Doing" }).click();
  await ada.page.getByText("To do", { exact: true }).filter({ visible: true }).last().click();
  await ada.page.getByRole("button", { name: "Close" }).last().click();

  await expect(visible(ada.page, "column-Doing")).toHaveCount(0);
  await expect(ada.page.getByTestId("column-To do").getByTestId("task-Phone screen with Sam")).toBeVisible();
  await ada.context.close();
});

test("sign-in mistakes are explained", async ({ browser }) => {
  const ada = await person(browser, "Ada Obi");
  await ada.context.clearCookies();
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByTestId("name").fill("Someone");
  await page.getByTestId("email").fill(ada.email);
  await page.getByTestId("password").fill("correct horse");
  await page.getByTestId("submit").click();
  await expect(page.getByText("There's already an account with that email. Log in instead.")).toBeVisible();
  await page.getByText("I have an account").click();
  await page.getByTestId("password").fill("wrong password");
  await page.getByTestId("submit").click();
  await expect(page.getByText("That email and password don't match")).toBeVisible();
  await ada.context.close();
});
