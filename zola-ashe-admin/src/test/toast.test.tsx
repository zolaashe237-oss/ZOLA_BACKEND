import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/Toast";

function ToastTrigger({ message, kind }: { message: string; kind?: "success" | "error" | "info" }) {
  const { toast } = useToast();
  return <button onClick={() => toast(message, kind)}>Déclencher</button>;
}

function renderWithToast(message: string, kind?: "success" | "error" | "info") {
  return render(
    <ToastProvider>
      <ToastTrigger message={message} kind={kind} />
    </ToastProvider>
  );
}

describe("ToastProvider", () => {
  it("n'affiche pas de toast au départ", () => {
    renderWithToast("Bonjour");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("affiche un toast success après déclenchement", () => {
    renderWithToast("Sauvegardé avec succès");
    fireEvent.click(screen.getByText("Déclencher"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Sauvegardé avec succès")).toBeInTheDocument();
  });

  it("affiche l'icône ✓ pour un toast success", () => {
    renderWithToast("OK", "success");
    fireEvent.click(screen.getByText("Déclencher"));
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("affiche l'icône ✕ pour un toast error", () => {
    renderWithToast("Erreur", "error");
    fireEvent.click(screen.getByText("Déclencher"));
    expect(screen.getByRole("alert").querySelector(".toast-icon")).toHaveTextContent("✕");
  });

  it("affiche l'icône ℹ pour un toast info", () => {
    renderWithToast("Info", "info");
    fireEvent.click(screen.getByText("Déclencher"));
    expect(screen.getByText("ℹ")).toBeInTheDocument();
  });

  it("ferme le toast en cliquant sur le bouton fermer", async () => {
    vi.useFakeTimers();
    renderWithToast("À fermer");
    fireEvent.click(screen.getByText("Déclencher"));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Fermer la notification"));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("n'affiche pas de toast si le message est vide", () => {
    renderWithToast("");
    fireEvent.click(screen.getByText("Déclencher"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
