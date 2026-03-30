/**
 * Paleta kolorów HusariaBot — G2 Hussars
 *
 * Centralny motyw kolorystyczny wykorzystywany we wszystkich embedach.
 * Barwy: czerwony, biały, szary, złoty.
 */
export const HusariaColors = {
    /** Główny kolor — husaria czerwona 🇵🇱 */
    RED:        0xDC143C,
    /** Biały — lekko stonowany, czytelny na ciemnym tle */
    WHITE:      0xF5F5F5,
    /** Ciemny szary — tło / subtelne embedy */
    DARK_GRAY:  0x2C2F33,
    /** Jasny szary — akcenty, drugorzędne info */
    LIGHT_GRAY: 0x99AAB5,
    /** Złoty — specjalne okazje, wyróżnienia */
    GOLD:       0xFFD700,
    /** Zielony — wygrane mecze */
    GREEN:      0x57F287,
} as const;

/** Mapowanie polskich nazw kolorów na wartości hex (do wyboru w komendach) */
export const ColorChoices: Record<string, number> = {
    czerwony: HusariaColors.RED,
    biały:    HusariaColors.WHITE,
    szary:    HusariaColors.DARK_GRAY,
    złoty:    HusariaColors.GOLD,
};
