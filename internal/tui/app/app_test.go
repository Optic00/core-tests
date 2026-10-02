//go:build test

package app

import (
	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/textinput"
	uv "github.com/charmbracelet/ultraviolet"
	"image/color"
	"strings"
	"testing"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"windshift/internal/tui/core"
	"windshift/internal/tui/data"
	"windshift/internal/tui/dialog"
	"windshift/internal/tui/styles"
)

type stubScreen struct{}

func (stubScreen) Init() tea.Cmd            { return nil }
func (stubScreen) Update(tea.Msg) tea.Cmd   { return nil }
func (stubScreen) View() string             { return "BOARD-CONTEXT" }
func (stubScreen) SetSize(int, int)         {}
func (stubScreen) Title() string            { return "Board" }
func (stubScreen) ShortHelp() []key.Binding { return nil }

type resultDialog struct{ got any }

func (d *resultDialog) ID() string                              { return "parent" }
func (d *resultDialog) Title() string                           { return "Parent" }
func (d *resultDialog) HandleKey(tea.KeyPressMsg) dialog.Action { return dialog.Action{} }
func (d *resultDialog) View(int, int) string                    { return "parent" }
func (d *resultDialog) HandleResult(msg dialog.ResultMsg) tea.Cmd {
	d.got = msg.Value
	return nil
}

type trackingScreen struct{ messages int }

func (*trackingScreen) Init() tea.Cmd            { return nil }
func (s *trackingScreen) Update(tea.Msg) tea.Cmd { s.messages++; return nil }
func (*trackingScreen) View() string             { return "screen" }
func (*trackingScreen) SetSize(int, int)         {}
func (*trackingScreen) Title() string            { return "screen" }
func (*trackingScreen) ShortHelp() []key.Binding { return nil }

type lifecycleDialog struct{ messages int }

func (*lifecycleDialog) ID() string                              { return "lifecycle" }
func (*lifecycleDialog) Title() string                           { return "Lifecycle" }
func (*lifecycleDialog) HandleKey(tea.KeyPressMsg) dialog.Action { return dialog.Action{} }
func (*lifecycleDialog) View(int, int) string                    { return "dialog" }
func (d *lifecycleDialog) HandleMessage(tea.Msg) tea.Cmd         { d.messages++; return nil }

func TestThemeKeyOpensPicker(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	updated, _ := m.handleKey(tea.KeyPressMsg(tea.Key{Code: 't', Text: "t"}))
	got := updated.(Model)
	if len(got.dialogs) != 1 || got.dialogs[0].ID() != themePickerID {
		t.Fatalf("theme key did not open the theme picker: %#v", got.dialogs)
	}
}

func TestOverlayRetainsApplicationContext(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	picker := dialog.NewPicker("test", "Choose", []dialog.Option{{Label: "One", Value: 1}}, 0, ctx.Styles)
	content := strings.Repeat("background row\n", 20)
	got := m.overlayDialog(content, picker)
	if !strings.Contains(got, "background row") || !strings.Contains(got, "Choose") {
		t.Fatalf("overlay should contain both background and dialog, got %q", got)
	}
}

func TestChildPickerReturnsResultToParentDialog(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	parent := &resultDialog{}
	child := dialog.NewPicker("child", "Child", []dialog.Option{{Label: "Selected", Value: 42}}, 0, ctx.Styles)
	m.dialogs = []dialog.Dialog{parent, child}

	updated, _ := m.handleKey(tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter}))
	got := updated.(Model)
	if len(got.dialogs) != 1 || got.dialogs[0] != parent {
		t.Fatalf("child picker should close back to its parent: %#v", got.dialogs)
	}
	if parent.got != 42 {
		t.Fatalf("picker result did not reach parent dialog: %#v", parent.got)
	}
}

func TestCtrlCQuitsWithDialogOpen(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	m.dialogs = []dialog.Dialog{dialog.NewPicker("picker", "Picker", nil, 0, ctx.Styles)}

	_, cmd := m.handleKey(tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl}))
	if cmd == nil {
		t.Fatal("ctrl+c returned no command")
	}
	if _, ok := cmd().(tea.QuitMsg); !ok {
		t.Fatalf("ctrl+c command returned %T, want tea.QuitMsg", cmd())
	}
}

func TestAsyncMessagesReachOnlyActiveScreen(t *testing.T) {
	ctx := testContext()
	hidden := &trackingScreen{}
	active := &trackingScreen{}
	m := New(ctx, hidden)
	m.stack = append(m.stack, active)

	m.Update(data.WorkspacesLoadedMsg{RequestID: 1})
	if hidden.messages != 0 || active.messages != 1 {
		t.Fatalf("message counts = hidden %d active %d, want 0 and 1", hidden.messages, active.messages)
	}
}

func TestNonKeyMessagesReachTopDialog(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	d := &lifecycleDialog{}
	m.dialogs = []dialog.Dialog{d}

	m.Update(struct{ blink bool }{blink: true})
	if d.messages != 1 {
		t.Fatalf("dialog messages = %d, want 1", d.messages)
	}
}

func TestViewDisablesUnsupportedMouseCapture(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	if got := m.View().MouseMode; got != tea.MouseModeNone {
		t.Fatalf("MouseMode = %v, want MouseModeNone", got)
	}
}

func TestLatePrefsLoadPreservesLocalChanges(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	updated, _ := m.Update(core.PrefsChangeMsg{Theme: "dracula", SetTheme: true})
	m = updated.(Model)
	ratio := 0.6
	workspaceID := 9
	updated, _ = m.Update(data.PrefsLoadedMsg{OK: true, Prefs: data.Prefs{
		Theme: "nord", SplitRatio: &ratio, LastWorkspaceID: &workspaceID,
	}})
	m = updated.(Model)
	if m.ctx.Prefs.Theme != "dracula" || m.ctx.Prefs.SplitRatio == nil || *m.ctx.Prefs.SplitRatio != ratio || m.ctx.Prefs.LastWorkspaceID == nil || *m.ctx.Prefs.LastWorkspaceID != workspaceID {
		t.Fatalf("merged prefs = %+v, want local theme and remote untouched fields", m.ctx.Prefs)
	}
}

func TestPreferenceWritesAreSerializedAndLatestSnapshotQueues(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	m.prefsKnown = true

	updated, first := m.Update(core.PrefsChangeMsg{Theme: "dracula", SetTheme: true})
	m = updated.(Model)
	if first == nil || !m.prefsSaving || m.prefsSavingVersion != 1 {
		t.Fatalf("first save state = cmd %v saving %v version %d", first != nil, m.prefsSaving, m.prefsSavingVersion)
	}
	updated, second := m.Update(core.PrefsChangeMsg{SplitRatio: 0.7, SetSplitRatio: true})
	m = updated.(Model)
	if second != nil || !m.prefsSaving || m.prefsVersion != 2 {
		t.Fatalf("queued save state = cmd %v saving %v version %d", second != nil, m.prefsSaving, m.prefsVersion)
	}
	updated, next := m.Update(data.PrefsSavedMsg{Version: 1})
	m = updated.(Model)
	if next == nil || !m.prefsSaving || m.prefsSavingVersion != 2 {
		t.Fatalf("latest save state = cmd %v saving %v version %d", next != nil, m.prefsSaving, m.prefsSavingVersion)
	}
}

func TestPreferenceSaveFailurePreservesLocalState(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	m.prefsKnown = true
	updated, _ := m.Update(core.PrefsChangeMsg{Theme: "dracula", SetTheme: true})
	m = updated.(Model)
	updated, _ = m.Update(data.PrefsSavedMsg{Version: 1, Err: "network down"})
	m = updated.(Model)
	if m.ctx.Prefs.Theme != "dracula" {
		t.Fatalf("theme = %q, want local value preserved", m.ctx.Prefs.Theme)
	}
	if !strings.Contains(m.notice.Text, "network down") {
		t.Fatalf("notice = %q, want scoped save failure", m.notice.Text)
	}
}

func TestUnownedErrorDoesNotSetGlobalNotice(t *testing.T) {
	ctx := testContext()
	m := New(ctx, stubScreen{})
	updated, _ := m.Update(data.ErrorMsg{Operation: data.OpWorkItems, WorkspaceID: 99, RequestID: 1, Err: "stale"})
	if got := updated.(Model).notice.Text; got != "" {
		t.Fatalf("stale error set global notice %q", got)
	}
}

func TestTinyTerminalUsesBoundedMinimumSizeView(t *testing.T) {
	ctx := testContext()
	ctx.Width = 10
	ctx.Height = 3
	m := New(ctx, stubScreen{})
	m.dialogs = []dialog.Dialog{dialog.NewPicker("picker", "Picker", []dialog.Option{{Label: "A very long option"}}, 0, ctx.Styles)}
	content := m.View().Content
	lines := strings.Split(content, "\n")
	if len(lines) > ctx.Height {
		t.Fatalf("view height = %d, want at most %d", len(lines), ctx.Height)
	}
	for _, line := range lines {
		if width := lipgloss.Width(line); width > ctx.Width {
			t.Fatalf("line width = %d, want at most %d: %q", width, ctx.Width, line)
		}
	}
}

func testContext() *core.Ctx {
	return &core.Ctx{
		Styles: styles.New(styles.CatppuccinMocha()),
		Theme:  styles.DefaultTheme,
		Keys:   core.DefaultKeyMap(),
		Width:  80,
		Height: 24,
	}
}

func TestEditDialogRendersNeutralBackground(t *testing.T) {
	for _, theme := range styles.Themes() {
		t.Run(theme.Name, func(t *testing.T) {
			ctx := testContext()
			ctx.Styles = styles.New(theme.Palette)
			m := New(ctx, stubScreen{})
			area := textarea.New()
			area.SetHeight(4)
			form := dialog.NewForm("edit", "Edit", []dialog.FormField{
				{Key: "title", Label: "Title", Input: textinput.New()},
				{Key: "description", Label: "Description", Multiline: true, Area: area},
			}, ctx.Styles, 40)
			for _, key := range []tea.Key{{}, {Code: tea.KeyDown}, {Code: tea.KeyEnter}} {
				form.HandleKey(tea.KeyPressMsg(key))
				rendered := m.overlayDialog("", form)
				cells := 0
				canvas := lipgloss.NewCanvas(lipgloss.Width(rendered), lipgloss.Height(rendered))
				canvas.Compose(uv.NewStyledString(rendered))
				for y := range canvas.Height() {
					for x := range canvas.Width() {
						cell := canvas.CellAt(x, y)
						if cell == nil || cell.Style.Bg == nil {
							continue
						}
						cells++
						got := color.RGBAModel.Convert(cell.Style.Bg)
						want := color.RGBAModel.Convert(theme.Palette.BgBase)
						if got != want {
							t.Fatalf("dialog background = %v, want neutral %v", got, want)
						}
					}
				}
				if cells == 0 {
					t.Fatal("dialog rendered without an opaque background")
				}
			}
		})
	}
}
