import { api } from "./api";

let users = [];
let items = [];
let outfits = [];

function fillSelect(selectId, entries, formatter) {
  const select = document.getElementById(selectId);
  select.innerHTML = entries
    .map((entry) => `<option value="${entry.id}">${formatter(entry)}</option>`)
    .join("");
}

async function loadData() {
  [users, items, outfits] = await Promise.all([
    api.get("/users"),
    api.get("/items"),
    api.get("/outfits"),
  ]);

  fillSelect("outfit-user-id", users, (u) => `${u.full_name} (${u.email})`);
  fillSelect("target-item", items, (i) => `${i.name} ${i.color ? `(${i.color})` : ""}`);
  fillSelect("target-outfit", outfits, (o) => o.name);

  document.getElementById("outfits-list").innerHTML = outfits
    .map(
      (outfit) => `
      <li>
        <div class="row-top"><strong>${outfit.name}</strong><span class="muted">${outfit.occasion || "Everyday"}</span></div>
        <div class="muted">Items: ${outfit.items.length}</div>
      </li>
    `
    )
    .join("");
}

async function createOutfit(event) {
  event.preventDefault();

  await api.post("/outfits", {
    user_id: Number(document.getElementById("outfit-user-id").value),
    name: document.getElementById("outfit-name").value,
    occasion: document.getElementById("outfit-occasion").value || null,
  });

  event.target.reset();
  await loadData();
}

async function addItemToOutfit(event) {
  event.preventDefault();

  const outfitId = Number(document.getElementById("target-outfit").value);
  const itemId = Number(document.getElementById("target-item").value);

  await api.post(`/outfits/${outfitId}/items`, {
    clothing_item_id: itemId,
  });

  await loadData();
}

async function init() {
  await loadData();
  document.getElementById("outfit-form").addEventListener("submit", createOutfit);
  document.getElementById("outfit-item-form").addEventListener("submit", addItemToOutfit);
}

init().catch((error) => {
  console.error(error);
  document.getElementById("outfits-list").innerHTML = "<li>Could not load outfits</li>";
});
