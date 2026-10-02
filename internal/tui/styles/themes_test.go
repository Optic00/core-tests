//go:build test

package styles

import (
	"fmt"
	"image/color"
	"math"
	"testing"
)

func TestThemesAreTerminalColorsCatalog(t *testing.T) {
	themes := Themes()
	if len(themes) != 11 {
		t.Fatalf("expected 11 terminal themes, got %d", len(themes))
	}
	want := []string{
		"catppuccin-mocha", "catppuccin-frappe", "dracula", "nord", "gruvbox-dark", "tokyo-night",
		"kanagawa-wave", "rose-pine", "everforest-dark", "solarized-dark", "one-dark",
	}
	for i, name := range want {
		if themes[i].Name != name {
			t.Errorf("theme %d: want %q, got %q", i, name, themes[i].Name)
		}
	}
}

func TestLegacyThemesResolveToCatppuccin(t *testing.T) {
	for _, name := range []string{"windshift-dark", "void", "onyx", "system"} {
		if got := ByName(name).Name; got != DefaultTheme {
			t.Errorf("legacy theme %q resolved to %q", name, got)
		}
	}
}

func TestTerminalThemeDialogsUseBaseBackground(t *testing.T) {
	for _, theme := range Themes() {
		if fmt.Sprint(theme.Palette.BgOverlay) != fmt.Sprint(theme.Palette.BgBase) {
			t.Errorf("theme %q gives dialogs a mismatched background", theme.Name)
		}
		if fmt.Sprint(theme.Palette.BgSurfaceHovered) != fmt.Sprint(theme.Palette.Selected) {
			t.Errorf("theme %q gives focused fields a non-selection background", theme.Name)
		}
	}
}

func TestFormTextRemainsReadableAcrossThemes(t *testing.T) {
	for _, theme := range Themes() {
		t.Run(theme.Name, func(t *testing.T) {
			s := New(theme.Palette)
			for name, pair := range map[string][2]color.Color{
				"hint":          {s.Palette.FgMuted, s.Palette.BgOverlay},
				"focused input": {s.Form.InputFocused.GetForeground(), s.Form.InputFocused.GetBackground()},
			} {
				a, b := textLuminance(pair[0]), textLuminance(pair[1])
				contrast := (max(a, b) + 0.05) / (min(a, b) + 0.05)
				if contrast < 4.5 {
					t.Errorf("%s contrast = %.2f, want at least 4.5", name, contrast)
				}
			}
		})
	}
}

func textLuminance(c color.Color) float64 {
	r, g, b, _ := c.RGBA()
	linear := func(v uint32) float64 {
		x := float64(v) / 65535
		if x <= 0.04045 {
			return x / 12.92
		}
		return math.Pow((x+0.055)/1.055, 2.4)
	}
	return 0.2126*linear(r) + 0.7152*linear(g) + 0.0722*linear(b)
}
