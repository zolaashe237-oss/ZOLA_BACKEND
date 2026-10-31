import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "@/components/Modal";

function renderModal(onClose = vi.fn(), title?: string) {
  return render(
    <Modal onClose={onClose} title={title}>
      <p>Contenu du modal</p>
    </Modal>
  );
}

describe("Modal", () => {
  it("affiche le contenu enfant", () => {
    renderModal();
    expect(screen.getByText("Contenu du modal")).toBeInTheDocument();
  });

  it("affiche le titre si fourni", () => {
    renderModal(vi.fn(), "Modifier le membre");
    expect(screen.getByText("Modifier le membre")).toBeInTheDocument();
  });

  it("n'affiche pas de titre si absent", () => {
    renderModal();
    expect(screen.queryByText("Modifier le membre")).not.toBeInTheDocument();
  });

  it("appelle onClose en appuyant sur Escape", () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("appelle onClose en cliquant sur l'overlay", () => {
    const onClose = vi.fn();
    const { container } = renderModal(onClose);
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("bloque le scroll du body à l'ouverture", () => {
    renderModal();
    expect(document.body.style.overflow).toBe("hidden");
  });
});
