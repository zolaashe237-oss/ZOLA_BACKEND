import { describe, it, expect, beforeEach } from "vitest";
import { getMediaUrl, setAccessToken } from "@/lib/api";

describe("getMediaUrl", () => {
  it("retourne une chaîne vide si path est null", () => {
    expect(getMediaUrl(null)).toBe("");
  });

  it("retourne une chaîne vide si path est undefined", () => {
    expect(getMediaUrl(undefined)).toBe("");
  });

  it("retourne l'URL telle quelle si elle commence par http", () => {
    const url = "https://cdn.example.com/media/photo.jpg";
    expect(getMediaUrl(url)).toBe(url);
  });

  it("retourne l'URL telle quelle si elle commence par blob:", () => {
    const url = "blob:http://localhost/abc-123";
    expect(getMediaUrl(url)).toBe(url);
  });

  it("retourne l'URL telle quelle si elle commence par data:", () => {
    const url = "data:image/png;base64,abc";
    expect(getMediaUrl(url)).toBe(url);
  });

  it("préfixe un chemin relatif avec la racine du serveur", () => {
    const result = getMediaUrl("/media/fichier.jpg");
    expect(result).toBe("http://localhost:8010/media/fichier.jpg");
  });

  it("ajoute un slash si le chemin ne commence pas par /", () => {
    const result = getMediaUrl("media/fichier.jpg");
    expect(result).toBe("http://localhost:8010/media/fichier.jpg");
  });
});

describe("setAccessToken", () => {
  beforeEach(() => {
    setAccessToken(null);
  });

  it("accepte un token string sans erreur", () => {
    expect(() => setAccessToken("mon-token-jwt")).not.toThrow();
  });

  it("accepte null sans erreur", () => {
    expect(() => setAccessToken(null)).not.toThrow();
  });
});
