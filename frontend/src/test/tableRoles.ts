import { expect } from "vitest";

function expectedCellRole(cell: Element): string {
  if (cell.tagName === "TD") return "cell";
  return cell.getAttribute("scope") === "row" ? "rowheader" : "columnheader";
}

export function expectTableRolesIndependentOfLayout(table: HTMLElement) {
  expect(table.tagName, "the element is the table itself").toBe("TABLE");
  expect(table, "the table states its role").toHaveAttribute("role", "table");
  for (const group of table.querySelectorAll("thead, tbody")) {
    expect(group, `a ${group.tagName.toLowerCase()} states its role`).toHaveAttribute("role", "rowgroup");
  }
  for (const row of table.querySelectorAll("tr")) {
    expect(row, "a row states its role").toHaveAttribute("role", "row");
  }
  for (const cell of table.querySelectorAll("th, td")) {
    expect(cell, `a ${cell.tagName.toLowerCase()} states its role`).toHaveAttribute("role", expectedCellRole(cell));
  }
}
