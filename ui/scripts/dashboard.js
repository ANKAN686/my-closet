import { api } from "./api";

function statCard(label, value) {
  return `
    <article class="panel">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
    </article>
  `;
}

async function loadDashboard() {
  const [users, items, outfits, wearLogs] = await Promise.all([
    api.get("/users"),
    api.get("/items"),
    api.get("/outfits"),
    api.get("/wear-logs"),
  ]);

  document.getElementById("stats").innerHTML = [
    statCard("Users", users.length),
    statCard("Items", items.length),
    statCard("Outfits", outfits.length),
    statCard("Wear Logs", wearLogs.length),
  ].join("");

  const recentItems = items.slice(0, 5);
  const recentLogs = wearLogs.slice(0, 5);

  document.getElementById("recent-items").innerHTML = recentItems
    .map(
      (item) => `
      <li>
        <div class="row-top"><strong>${item.name}</strong><span class="muted">${item.category_name || "Uncategorized"}</span></div>
        <div class="muted">${item.brand || "No brand"} • ${item.color || "No color"}</div>
      </li>
    `
    )
    .join("");

  document.getElementById("recent-logs").innerHTML = recentLogs
    .map(
      (log) => `
      <li>
        <div class="row-top"><strong>${log.item_name || "Item"}</strong><span class="muted">${log.worn_on}</span></div>
        <div class="muted">Outfit: ${log.outfit_name || "None"}</div>
      </li>
    `
    )
    .join("");
}

loadDashboard().catch((error) => {
  console.error(error);
  document.getElementById("stats").innerHTML = '<article class="panel">Could not load dashboard data.</article>';
});
