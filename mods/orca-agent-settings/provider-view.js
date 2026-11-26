// The Model providers page: a back arrow, a title and one card for each saved provider. Each
// builder takes the page (`owner`) and reads its cards; the logic that saves and deletes stays in main.js.
import { div, svg } from "gpui-kit";
import { Button, v_flex, h_flex, Input } from "gpui-base";
import { appHome, theme } from "herdr";
import { keyHint, linkInfo, presetFor } from "./codex-provider.js";
import { backButton, icon } from "./parts.js";

const HARD_DRIVE = "mods/orca-assets/hard-drive.svg";
// An icon is drawn from its path inside this app's folder.
const iconSrc = (path) => (String(path).startsWith(`${appHome()}/`) ? String(path).slice(appHome().length + 1) : path);
// A saved provider's picture, or the generic drive when it has none.
const providerIcon = (path) => (path ? { icon: iconSrc(path) } : { icon: HARD_DRIVE, tint: true });

export function providersPageView(owner) {
  const t = theme();
  return v_flex()
    .id("am-root")
    .size_full()
    .min_h(0)
    .overflow_hidden()
    .bg(t.background)
    .text_size(12)
    .child(
      h_flex()
        .w_full()
        .max_w(760)
        .mx_auto()
        .px(24)
        .pt(20)
        .pb(12)
        .items_center()
        .gap(8)
        .child(backButton(t, () => owner.showTerminals()))
        .child(div().text_size(20).font_semibold().text_color(t.foreground).child("Model providers")),
    )
    .child(
      v_flex()
        .id("am-providers")
        .w_full()
        .min_h(0)
        .flex_1()
        .overflow_y_scrollbar()
        .child(
          v_flex()
            .w_full()
            .max_w(760)
            .mx_auto()
            .px(24)
            .pb(24)
            .gap(8)
            .child(div().text_size(11).line_height("16px").text_color(t.muted).child("Setup checks whether /models returns a model list; it does not confirm the key was accepted or verify that each agent can chat."))
            .child(owner.modelProvidersCard(t)),
        ),
    );
}

/** Provider list, provider detail, or the add form. */
export function modelProvidersView(owner, t) {
  if (owner.adding) return addProviderView(owner, t);
  if (owner.selectedProviderId && owner.providers[owner.selectedProviderId]) {
    return providerDetailView(owner, owner.selectedProviderId, t);
  }
  return v_flex()
    .w_full()
    .w_full()
    .max_w(520)
    .items_center()
    .justify_center()
    .min_h(240)
    .rounded(12)
    .border_1()
    .border_color(t.border)
    .bg(t.surface)
    .child(div().text_size(13).text_color(t.muted).child(owner.providersError ?? "Choose a provider from the left rail, or add one with +."));
}

function addProviderView(owner, t) {
  return v_flex().w_full().gap(10)
    .child(div().text_size(17).font_semibold().text_color(t.foreground).child("Add model provider"))
    .child(div().text_size(11).text_color(t.dim).child("A provider is added after its /models endpoint returns a model list."))
    .child(owner.providerCard(owner.adding, t));
}

function providerDetailView(owner, id, t) {
  const record = owner.providers[id];
  const card = owner.cards.get(id);
  const health = owner.providerHealthState(id);
  const healthTone = { healthy: t.done, checking: t.accent, unhealthy: t.blocked, unknown: t.dim }[health.state] ?? t.dim;
  const healthLabel = { healthy: "Healthy", checking: "Checking…", unhealthy: "Unhealthy", unknown: "Not checked" }[health.state] ?? "Not checked";
  const models = health.models?.length ? health.models : (record.models ?? []);
  return v_flex().w_full().gap(12)
    .child(
      h_flex().w_full().gap(12).items_center().p(12).rounded(10).border_1().border_color(t.border).bg(t.raised)
        .child(icon(providerIcon(record.iconPath), 40, t))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().min_w(0).truncate().text_size(16).font_semibold().text_color(t.foreground).child(record.name || "Provider"))
          .child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(record.host ?? "")))
        .child(div().size(9).flex_none().rounded_full().bg(healthTone).tooltip(healthLabel))
        .child(div().flex_none().text_size(11).text_color(healthTone).child(healthLabel)),
    )
    .child(
      h_flex().w_full().gap(8).items_center()
        .child(owner.button(`am-provider-check-${id}`, "Check health", t, (_event, cx) => owner.refreshProviderHealth(id, cx), { height: 26, px: 10, color: t.muted, disabled: health.state === "checking" }))
        .child(owner.button(`am-provider-edit-${id}`, card?.open ? "Done editing" : "Edit provider", t, (_event, cx) => {
          if (card) card.open = !card.open;
          cx.notify();
        }, { height: 26, px: 10, color: t.accent })),
    )
    .when(health.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child(health.error)))
    .when(card?.open, (el) => el.child(owner.providerCard(card, t)))
    .child(v_flex().w_full().gap(6)
      .child(h_flex().w_full().items_center().gap(8)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Models"))
        .child(div().text_size(11).text_color(t.muted).child(`${models.length}`)))
      .when(models.length === 0, (el) => el.child(div().text_size(11).text_color(t.dim).child("No model list available.")))
      .children(models.map((model, index) => div().id(`am-provider-model-${id}-${index}`).w_full().px(10).py(7).rounded(6).bg(t.raised)
        .text_size(12).text_color(t.foreground).child(String(model)))));
}

// One saved provider, or the one being added (`card.id` is null): a header that opens an editor.
export function providerCardView(owner, card, t) {
  const record = card.id ? owner.providers[card.id] : null;
  const idPart = card.id ?? "new";
  return v_flex()
    .id(`am-provider-${idPart}`)
    .w_full()
    .rounded(10)
    .border_1()
    .border_color(card.id ? t.border : t.accent)
    .bg(t.raised)
    .child(cardHeader(card, record, t))
    .when(card.open || !card.id, (el) => el.child(cardEditor(owner, card, record, t)));
}

function cardHeader(card, record, t) {
  const title = record?.name ?? "New provider";
  const saved = record ? String(record.host ?? "").replace(/^https?:\/\//, "") : "";
  return h_flex()
    .id(`am-provider-head-${card.id ?? "new"}`)
    .w_full()
    .p(10)
    .gap(10)
    .items_center()
    .when(card.id, (el) =>
      el.cursor_pointer().on_click((_event, cx) => {
        card.open = !card.open;
        cx.notify();
      }),
    )
    .child(icon(providerIcon(record?.iconPath), 32, t))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(1)
        .child(div().text_size(13).font_medium().text_color(t.foreground).child(title))
        .child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(saved || "Not saved yet")),
    )
    .when(record, (el) =>
      el
        .child(div().flex_none().text_size(11).text_color(t.muted).child(`${record.models?.length ?? 0} models`))
        .child(div().flex_none().text_size(11).text_color(t.done).child(`● ${new Date(record.verifiedAt).toTimeString().slice(0, 5)}`))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(card.open ? "▾" : "▸")),
    );
}

// The frame every input of the card sits in.
const inputFrame = (t) =>
  h_flex().w_full().h(32).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.input).bg(t.background);

const fieldColumn = (id, label, t) =>
  v_flex()
    .id(id)
    .flex_1()
    .min_w(170)
    .gap(4)
    .child(div().text_size(10).font_semibold().text_color(t.dim).child(label));

function inputField(id, label, state, extra, t) {
  return fieldColumn(id, label, t).child(
    inputFrame(t)
      .when(extra?.before, (el) => el.child(extra.before))
      .child(Input.new(state).flex_1().min_w(0).text_size(12).text_color(t.foreground).bg("#00000000"))
      .when(extra?.after, (el) => el.child(extra.after)),
  );
}

// A saved key is shown as a hint until Replace is pressed; otherwise the key is an input.
function keyField(owner, card, record, t) {
  if (record && !card.replacing) {
    return fieldColumn(`am-key-${card.id}`, "API KEY", t).child(
      inputFrame(t)
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(keyHint(record.apiKey)))
        .child(
          owner.button(`am-key-replace-${card.id}`, "Replace", t, (_event, cx) => {
            card.replacing = true;
            cx.notify();
          }, { height: 22, px: 8, color: t.muted }),
        ),
    );
  }
  return inputField(`am-key-${card.id ?? "new"}`, "API KEY", card.key, { after: revealButton(card, t) }, t);
}

function revealButton(card, t) {
  const label = card.reveal ? "Hide key" : "Show key";
  return Button.new(`am-key-eye-${card.id ?? "new"}`)
    .disabled(false)
    .size(22)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(5)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .role("button")
    .accessibility_label(label)
    .tooltip(label)
    .on_click((_event, cx) => {
      card.reveal = !card.reveal;
      card.key.set_masked(!card.reveal);
      cx.notify();
    })
    .child(svg(card.reveal ? "mods/orca-assets/eye-off.svg" : "mods/orca-assets/eye--orca-agent-flyout.svg").size(14).text_color(t.muted));
}

// "Looks like <preset>" when the host is a known server and the name or link is still empty.
function presetOffer(owner, card, t) {
  const preset = presetFor(card.host.value());
  if (!preset || (card.name.value().trim() !== "" && card.link.value().trim() !== "")) return null;
  return h_flex()
    .gap(8)
    .items_center()
    .child(div().text_size(11).text_color(t.dim).child("Looks like"))
    .child(
      div()
        .id(`am-offer-${card.id ?? "new"}`)
        .px(8)
        .py(2)
        .rounded(99)
        .border_1()
        .border_color(t.accent)
        .text_size(11)
        .text_color(t.accent)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_event, cx) => {
          if (card.name.value().trim() === "") card.name.set_value(preset.name);
          if (card.link.value().trim() === "") card.link.set_value(preset.link);
          owner.linkChanged(card, cx);
        })
        .child(`${preset.name} · ${preset.link.replace("https://", "")}`),
    );
}

const LINK_HINT = "A GitHub link gives the repo name and the owner's avatar; any other https link gives its site name and favicon. The icon is downloaded once.";

function cardEditor(owner, card, record, t) {
  const idPart = card.id ?? "new";
  const info = linkInfo(card.link.value());
  const preview = providerIcon(card.fetched.path);
  const offer = presetOffer(owner, card, t);
  return v_flex()
    .w_full()
    .p(12)
    .gap(10)
    .border_t(1)
    .border_color(t.border)
    .child(
      h_flex()
        .w_full()
        .gap(8)
        .flex_wrap()
        .child(inputField(`am-name-${idPart}`, "NAME", card.name, undefined, t))
        .child(inputField(`am-host-${idPart}`, "HOST", card.host, undefined, t)),
    )
    .when(offer, (inner) => inner.child(offer))
    .child(
      h_flex()
        .w_full()
        .gap(8)
        .flex_wrap()
        .child(keyField(owner, card, record, t))
        .child(inputField(`am-link-${idPart}`, "PROJECT LINK · OPTIONAL (NAME AND ICON)", card.link, { before: icon(preview, 20, t) }, t)),
    )
    .child(div().text_size(10).text_color(t.dim).child(info.error ? "" : LINK_HINT))
    .child(cardActions(owner, card, t));
}

function cardActions(owner, card, t) {
  const tone = { blocked: t.blocked, done: t.done }[card.status?.tone] ?? t.muted;
  return h_flex()
    .w_full()
    .gap(10)
    .items_center()
    .flex_wrap()
    .child(
      owner.button(`am-save-${card.id ?? "new"}`, card.testing ? "Testing…" : "Test and save", t, (_event, cx) => owner.saveCard(card, cx), {
        height: 26,
        px: 12,
        color: t.accent,
        disabled: card.testing,
      }),
    )
    .when(!card.id, (inner) =>
      inner.child(
        owner.button("am-cancel-new", "Cancel", t, (_event, cx) => owner.cancelNewCard(card, cx), { height: 26, px: 10, color: t.muted, disabled: card.testing }),
      ),
    )
    .when(card.status, (inner) => inner.child(div().flex_1().min_w(120).text_size(11).text_color(tone).child(card.status.text)))
    .when(!card.status, (inner) => inner.child(div().flex_1()))
    .when(card.id, (inner) =>
      inner.child(owner.button(`am-delete-${card.id}`, "Delete", t, (_event, cx) => owner.deleteProvider(card, cx), { height: 26, px: 10, color: t.blocked, disabled: card.testing })),
    );
}
