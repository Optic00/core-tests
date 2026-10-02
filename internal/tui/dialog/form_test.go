//go:build test

package dialog

import (
	"strings"
	"testing"

	"charm.land/bubbles/v2/cursor"
	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	"windshift/internal/tui/styles"
)

func TestFormSubmitKeysAvoidCtrlS(t *testing.T) {
	s := styles.New(styles.CatppuccinMocha())
	area := textarea.New()
	area.SetValue("hello")
	form := NewForm("comment", "Comment", []FormField{{Key: "body", Multiline: true, Area: area}}, s, 40)

	ctrlS := tea.KeyPressMsg(tea.Key{Code: 's', Mod: tea.ModCtrl})
	if action := form.HandleKey(ctrlS); action.Close || action.Selected != nil {
		t.Fatal("ctrl+s must remain available to the terminal multiplexer")
	}

	if action := form.HandleKey(tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter})); action.Close {
		t.Fatal("enter should begin editing the selected field")
	}
	altEnter := tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter, Mod: tea.ModAlt})
	if action := form.HandleKey(altEnter); action.Close || action.Selected != nil {
		t.Fatal("alt+enter must not submit the form")
	}
	if action := form.HandleKey(tea.KeyPressMsg(tea.Key{Code: tea.KeyEscape})); action.Close {
		t.Fatal("escape should stop field editing without closing the form")
	}

	action := form.HandleKey(tea.KeyPressMsg(tea.Key{Code: 's', Text: "s"}))
	if !action.Close {
		t.Fatal("s should submit from field-selection mode")
	}
	result, ok := action.Selected.(FormResult)
	if !ok || result.Values["body"] != "hello" {
		t.Fatalf("unexpected form result: %#v", action.Selected)
	}
}

func TestFormPropagatesTextInputFocusCommand(t *testing.T) {
	s := styles.New(styles.CatppuccinMocha())
	input := textinput.New()
	form := NewForm("edit", "Edit", []FormField{{Key: "title", Input: input}}, s, 40)
	action := form.HandleKey(tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter}))
	if action.Cmd == nil {
		t.Fatal("beginning text input editing dropped the focus command")
	}
	if cmd := form.HandleMessage(cursor.Blink()); cmd == nil {
		t.Fatal("focused text input dropped the cursor lifecycle message")
	}
}

func TestFormViewIsBoundedAndResponsive(t *testing.T) {
	s := styles.New(styles.CatppuccinMocha())
	fields := make([]FormField, 8)
	for i := range fields {
		fields[i] = FormField{Key: string(rune('a' + i)), Label: "Field", Input: textinput.New()}
	}
	form := NewForm("long", "Long", fields, s, 70)
	view := form.View(12, 6)
	if got := len(strings.Split(view, "\n")); got > 6 {
		t.Fatalf("form height = %d, want at most 6", got)
	}
	if form.fields[0].Input.Width() > 12 {
		t.Fatalf("input width = %d, want at most 12", form.fields[0].Input.Width())
	}
}

func TestFormChoiceConsumesPickerResult(t *testing.T) {
	s := styles.New(styles.CatppuccinMocha())
	choice := &FormChoice{
		PickerID: "status",
		Options:  []Option{{Label: "Open", Value: 1}, {Label: "Done", Value: 2}},
		Value:    1,
	}
	form := NewForm("edit", "Edit", []FormField{{Key: "status", Label: "Status", Choice: choice}}, s, 40)
	form.HandleResult(ResultMsg{ID: "status", Value: 2})
	action := form.HandleKey(tea.KeyPressMsg(tea.Key{Code: 's', Text: "s"}))
	result := action.Selected.(FormResult)
	if got := result.Choices["status"]; got != 2 {
		t.Fatalf("picker result was not retained by the form: got %#v", got)
	}
}
