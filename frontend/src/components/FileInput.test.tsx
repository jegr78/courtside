import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { FileInput } from "./FileInput";

afterEach(async () => {
  await i18n.changeLanguage("de");
});

it("given German as the application language, when no file is chosen, then the trigger and status read in German", async () => {
  // given
  await i18n.changeLanguage("de");

  // when
  render(<label>Datei<FileInput id="list" data-testid="list-file" file={undefined} /></label>);

  // then
  expect(screen.getByTestId("list-file-trigger")).toHaveTextContent("Datei auswählen");
  expect(screen.getByTestId("list-file-status")).toHaveTextContent("Keine Datei ausgewählt");
  expect(screen.getByTestId("list-file"), "the status describes the native input").toHaveAccessibleDescription("Keine Datei ausgewählt");
  expect(screen.getByTestId("list-file"), "the field label still names the input").toHaveAccessibleName("Datei");
});

it("given English as the application language, when a file is chosen, then the trigger is English and the status names the file", async () => {
  // given
  await i18n.changeLanguage("en");

  // when
  render(<FileInput id="list" data-testid="list-file" file={new File(["1"], "members.csv")} />);

  // then
  expect(screen.getByTestId("list-file-trigger")).toHaveTextContent("Choose file");
  expect(screen.getByTestId("list-file-status")).toHaveTextContent("members.csv");
});

it("given a chosen file, when the owner clears it, then the status reads no file chosen again", async () => {
  // given
  await i18n.changeLanguage("en");
  const { rerender } = render(<FileInput id="list" data-testid="list-file" file={new File(["1"], "members.csv")} />);

  // when
  rerender(<FileInput id="list" data-testid="list-file" file={undefined} />);

  // then
  expect(screen.getByTestId("list-file-status")).toHaveTextContent("No file chosen");
});

it("given the visible trigger, when it is clicked, then the native input receives the chosen file", async () => {
  // given
  const changed = vi.fn();
  render(<label>File<FileInput id="list" data-testid="list-file" file={undefined} onChange={changed} /></label>);
  const input = screen.getByTestId<HTMLInputElement>("list-file");
  const opened = vi.fn();
  input.addEventListener("click", opened);

  // when
  await userEvent.click(screen.getByTestId("list-file-trigger"));

  // then
  expect(opened, "one click on the trigger opens the picker exactly once").toHaveBeenCalledTimes(1);
  await userEvent.upload(input, new File(["1"], "members.csv"));
  expect(changed).toHaveBeenCalledOnce();
  expect(input.files?.[0]?.name).toBe("members.csv");
});

it("given a disabled field, when the trigger is clicked, then the picker stays closed", async () => {
  // given
  render(<FileInput id="list" data-testid="list-file" file={undefined} disabled />);
  const opened = vi.fn();
  screen.getByTestId("list-file").addEventListener("click", opened);

  // when
  await userEvent.click(screen.getByTestId("list-file-trigger"));

  // then
  expect(opened).not.toHaveBeenCalled();
});

it("given the native input, when the keyboard reaches it, then it is the only tab stop of the field", async () => {
  // given
  render(<FileInput id="list" data-testid="list-file" file={undefined} />);

  // when
  await userEvent.tab();

  // then
  expect(screen.getByTestId("list-file")).toHaveFocus();
  expect(screen.getByTestId("list-file-trigger"), "the trigger is a pointer target only").toHaveAttribute("aria-hidden", "true");
  await userEvent.tab();
  expect(document.body, "no hidden second stop follows the input").toHaveFocus();
});
