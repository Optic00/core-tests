//go:build test

package sla

import (
	"testing"
	"time"

	"windshift/internal/businesstime"
	"windshift/internal/models"
)

func compileCoverageCalendar(t *testing.T, start, end string) *businesstime.Calendar {
	t.Helper()
	calendar, err := businesstime.Compile(businesstime.RawCalendar{
		Timezone:        "UTC",
		WeeklyIntervals: map[string][]businesstime.ClockInterval{"monday": {{Start: start, End: end}}},
	})
	if err != nil {
		t.Fatalf("compile calendar: %v", err)
	}
	return calendar
}

func TestCycleCoverage(t *testing.T) {
	now := time.Date(2026, 1, 5, 10, 0, 0, 0, time.UTC)
	scheduling := compileCoverageCalendar(t, "09:00", "17:00")
	team := compileCoverageCalendar(t, "09:00", "12:00")

	t.Run("no bound team reports reference none", func(t *testing.T) {
		block := CycleCoverage(scheduling, CoverageReference{}, now)
		if block.Reference != CoverageReferenceNone {
			t.Fatalf("reference = %q, want %q", block.Reference, CoverageReferenceNone)
		}
	})

	t.Run("an unresolvable reference is reported unknown", func(t *testing.T) {
		block := CycleCoverage(scheduling, CoverageReference{TeamIDs: []int{3}, Unresolved: true}, now)
		if block.Reference != CoverageReferenceUnknown {
			t.Fatalf("reference = %q, want %q", block.Reference, CoverageReferenceUnknown)
		}
	})

	t.Run("a wider SLA reports sla_wider with weekly numbers", func(t *testing.T) {
		block := CycleCoverage(scheduling, CoverageReference{TeamIDs: []int{3}, Calendars: []*businesstime.Calendar{team}}, now)
		if block.Reference != CoverageReferenceTeamServiceHours {
			t.Fatalf("reference = %q", block.Reference)
		}
		if block.Discrepancy != "sla_wider" {
			t.Fatalf("discrepancy = %q, want sla_wider", block.Discrepancy)
		}
		if block.SLAWeeklyMs != 8*3600*1000 || block.TeamWeeklyMs != 3*3600*1000 || block.OverlapWeeklyMs != 3*3600*1000 {
			t.Fatalf("weekly numbers = (%d, %d, %d)", block.SLAWeeklyMs, block.TeamWeeklyMs, block.OverlapWeeklyMs)
		}
		if block.SLAOutsideTeamWeeklyMs != 5*3600*1000 || block.TeamOutsideSLAWeeklyMs != 0 {
			t.Fatalf("outside numbers = (%d, %d)", block.SLAOutsideTeamWeeklyMs, block.TeamOutsideSLAWeeklyMs)
		}
		if !block.WithinTeamServiceHours {
			t.Fatal("expected within_team_service_hours at 10:00")
		}
		if block.Note != "sla_outside_team_service_hours" {
			t.Fatalf("note = %q", block.Note)
		}
	})

	t.Run("a wider team schedule reports team_wider", func(t *testing.T) {
		wideTeam := compileCoverageCalendar(t, "08:00", "18:00")
		block := CycleCoverage(scheduling, CoverageReference{TeamIDs: []int{3}, Calendars: []*businesstime.Calendar{wideTeam}}, now)
		if block.Discrepancy != "team_wider" {
			t.Fatalf("discrepancy = %q, want team_wider", block.Discrepancy)
		}
		if block.TeamOutsideSLAWeeklyMs != 2*3600*1000 {
			t.Fatalf("team outside = %d", block.TeamOutsideSLAWeeklyMs)
		}
	})

	t.Run("an aligned pair reports aligned without a note", func(t *testing.T) {
		block := CycleCoverage(scheduling, CoverageReference{TeamIDs: []int{3}, Calendars: []*businesstime.Calendar{scheduling}}, now)
		if block.Discrepancy != "aligned" || block.Note != "" {
			t.Fatalf("discrepancy/note = %q/%q, want aligned/empty", block.Discrepancy, block.Note)
		}
	})
}

// TestCycleCoverageIgnoresNilScheduling guards the read path: a cycle whose
// snapshot failed to compile must not fail the read.
func TestCycleCoverageIgnoresNilScheduling(t *testing.T) {
	block := CycleCoverage(nil, CoverageReference{TeamIDs: []int{3}}, time.Now())
	if block == nil || block.Reference != CoverageReferenceUnknown {
		t.Fatalf("block = %#v, want unknown reference", block)
	}
	_ = models.SLACoverage{}
}
