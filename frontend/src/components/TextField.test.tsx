import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { TextField } from "./TextField";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

it("given a password field, when its visibility control is activated twice, then the entry shows and is masked again", async () => {
  // given
  render(<TextField id="password" label="Password" data-testid="password" type="password" defaultValue="secret-entry" />);
  const field = screen.getByTestId("password");
  const control = screen.getByTestId("password-visibility");
  expect(field, "a password starts masked").toHaveAttribute("type", "password");
  expect(control).toHaveAttribute("aria-pressed", "false");

  // when
  await userEvent.click(control);

  // then
  expect(field, "the control reveals what was typed").toHaveAttribute("type", "text");
  expect(control).toHaveAttribute("aria-pressed", "true");
  expect(control).toHaveAttribute("aria-controls", "password");
  expect(field).toHaveValue("secret-entry");
  expect(field, "a revealed password is not sent to a spelling service").toHaveAttribute("spellcheck", "false");
  expect(field, "a revealed password is not rewritten").toHaveAttribute("autocorrect", "off");
  expect(field).toHaveAttribute("autocapitalize", "none");

  // when
  await userEvent.click(control);

  // then
  expect(field, "a second activation masks it again").toHaveAttribute("type", "password");
  expect(control).toHaveAttribute("aria-pressed", "false");
});

it("given a password field in a form, when its visibility control is activated, then the form is not submitted", async () => {
  // given
  const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  render(<form onSubmit={submit}>
    <TextField id="password" label="Password" data-testid="password" type="password" />
  </form>);

  // when
  await userEvent.click(screen.getByTestId("password-visibility"));

  // then
  expect(submit, "showing the password is not a submission").not.toHaveBeenCalled();
});

it("given a revealed password, when its form is submitted, then the field is masked before the browser reads it", async () => {
  // given
  const seen: string[] = [];
  const submit = vi.fn((event: { preventDefault: () => void }) => {
    event.preventDefault();
    seen.push(screen.getByTestId("password").getAttribute("type") ?? "");
  });
  render(<form onSubmit={submit}>
    <TextField id="password" label="Password" data-testid="password" type="password" defaultValue="secret-entry" />
    <button type="submit" data-testid="submit">Save</button>
  </form>);
  await userEvent.click(screen.getByTestId("password-visibility"));

  // when
  await userEvent.click(screen.getByTestId("submit"));

  // then
  expect(seen, "a password manager or form history reads a password field, not text").toEqual(["password"]);
  expect(screen.getByTestId("password")).toHaveAttribute("type", "password");
  expect(screen.getByTestId("password-visibility")).toHaveAttribute("aria-pressed", "false");
});

it("given German, when a password field renders, then its visibility control is named in German", async () => {
  // given
  await i18n.changeLanguage("de");

  // when
  render(<TextField id="password" label="Passwort" data-testid="password" type="password" />);

  // then
  expect(screen.getByTestId("password-visibility")).toHaveAccessibleName("Passwort anzeigen");
});

it("given a plain text field, when it renders, then it offers no visibility control", () => {
  // given / when
  render(<TextField id="username" label="Username" data-testid="username" />);

  // then
  expect(screen.getByTestId("username")).toHaveAccessibleName("Username");
  expect(screen.queryByTestId("username-visibility"), "only a password is masked").not.toBeInTheDocument();
});

it("given a password field, when it renders, then its label still names the field", () => {
  // given / when
  render(<TextField id="password" label="Password" data-testid="password" type="password" />);

  // then
  expect(screen.getByTestId("password")).toHaveAccessibleName("Password");
  expect(screen.getByTestId("password-visibility")).toHaveAccessibleName("Show password");
});
