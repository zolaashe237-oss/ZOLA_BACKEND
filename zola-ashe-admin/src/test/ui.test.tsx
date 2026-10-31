import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, Input, Card } from "@/components/ui";

describe("Button", () => {
  it("affiche son contenu", () => {
    render(<Button>Enregistrer</Button>);
    expect(screen.getByText("Enregistrer")).toBeInTheDocument();
  });

  it("affiche … quand loading est true", () => {
    render(<Button loading>Enregistrer</Button>);
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("est désactivé quand loading est true", () => {
    render(<Button loading>Enregistrer</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("est désactivé quand disabled est true", () => {
    render(<Button disabled>Enregistrer</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("appelle onClick au clic", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Cliquer</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("n'appelle pas onClick si désactivé", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Cliquer</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applique la classe btn-ghost avec variant ghost", () => {
    render(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn-ghost");
  });

  it("applique la classe btn-danger avec variant danger", () => {
    render(<Button variant="danger">Supprimer</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn-danger");
  });
});

describe("Input", () => {
  it("affiche le label", () => {
    render(<Input label="Nom complet" />);
    expect(screen.getByText("Nom complet")).toBeInTheDocument();
  });

  it("n'affiche pas de label si absent", () => {
    render(<Input placeholder="Nom" />);
    expect(screen.queryByText("Nom complet")).not.toBeInTheDocument();
  });

  it("a la classe input", () => {
    render(<Input label="Test" />);
    expect(screen.getByRole("textbox")).toHaveClass("input");
  });

  it("transmet les props HTML natives", () => {
    render(<Input label="Test" placeholder="Tapez ici" maxLength={50} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("placeholder", "Tapez ici");
    expect(input).toHaveAttribute("maxlength", "50");
  });
});

describe("Card", () => {
  it("affiche son contenu", () => {
    render(<Card><p>Contenu</p></Card>);
    expect(screen.getByText("Contenu")).toBeInTheDocument();
  });

  it("a la classe card", () => {
    const { container } = render(<Card>Test</Card>);
    expect(container.firstChild).toHaveClass("card");
  });
});
