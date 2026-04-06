import { api } from "./api";

let users = [];
let categories = [];

function option(value, label) {
  return `<option value="${value}">${label}</option>`;
}

async function loadSelects() {
  [users, categories] = await Promise.all([api.get("/users"), api.get("/categories")]);

  const userSelect = document.getElementById("user-id");
  userSelect.innerHTML = users.map((u) => option(u.id, `${u.full_name} (${u.email})`)).join("");

  const categorySelect = document.getElementById("category-id");
  categorySelect.innerHTML = `<option value="">Uncategorized</option>${categories
    .map((c) => option(c.id, c.name))
    .join("")}`;
}

async function loadItems() {
  const items = await api.get("/items");
  const body = document.getElementById("items-body");

  body.innerHTML = items
    .map(
      (item) => `
      <tr>
        <td>${item.name}</td>
        <td>${item.category_name || "-"}</td>
        <td>${item.brand || "-"}</td>
        <td>${item.color || "-"}</td>
      </tr>
    `
    )
    .join("");
}

async function handleCreate(event) {
  event.preventDefault();

  await api.post("/items", {
    user_id: Number(document.getElementById("user-id").value),
    category_id: document.getElementById("category-id").value
      ? Number(document.getElementById("category-id").value)
      : null,
    name: document.getElementById("name").value,
    brand: document.getElementById("brand").value || null,
    color: document.getElementById("color").value || null,
  });

  event.target.reset();
  await loadItems();
}

async function init() {
  await loadSelects();
  await loadItems();
  document.getElementById("item-form").addEventListener("submit", handleCreate);
}

init().catch((error) => {
  console.error(error);
  document.getElementById("items-body").innerHTML = "<tr><td colspan=\"4\">Could not load items</td></tr>";
});
