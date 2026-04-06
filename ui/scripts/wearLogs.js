import { api } from "./api";

let users = [];
let items = [];
let outfits = [];

function fillSelect(selectId, entries, formatter, includeEmpty = false) {
  const select = document.getElementById(selectId);
  const empty = includeEmpty ? '<option value="">None</option>' : "";
  select.innerHTML =
    empty +
    entries
      .map((entry) => `<option value="${entry.id}">${formatter(entry)}</option>`)
      .join("");
}

async function loadData() {
  [users, items, outfits] = await Promise.all([
    api.get("/users"),
    api.get("/items"),
    api.get("/outfits"),
  ]);

  fillSelect("log-user-id", users, (u) => `${u.full_name} (${u.email})`);
  fillSelect("log-item-id", items, (i) => i.name);
  fillSelect("log-outfit-id", outfits, (o) => o.name, true);

  const logs = await api.get("/wear-logs");
  document.getElementById("logs-body").innerHTML = logs
    .map(
      (log) => `
      <tr>
        <td>${log.worn_on}</td>
        <td>${log.item_name || "-"}</td>
        <td>${log.outfit_name || "-"}</td>
      </tr>
    `
    )
    .join("");
}

async function createLog(event) {
  event.preventDefault();

  await api.post("/wear-logs", {
    user_id: Number(document.getElementById("log-user-id").value),
    clothing_item_id: Number(document.getElementById("log-item-id").value),
    outfit_id: document.getElementById("log-outfit-id").value
      ? Number(document.getElementById("log-outfit-id").value)
      : null,
    worn_on: document.getElementById("log-date").value || null,
  });

  event.target.reset();
  await loadData();
}

async function init() {
  await loadData();
  document.getElementById("log-form").addEventListener("submit", createLog);
}

init().catch((error) => {
  console.error(error);
  document.getElementById("logs-body").innerHTML = "<tr><td colspan=\"3\">Could not load wear logs</td></tr>";
});
