//go:build test

package businesstime

import (
	"testing"
	"time"
)

func compileCalendar(t *testing.T, raw RawCalendar) *Calendar {
	t.Helper()
	calendar, err := Compile(raw)
	if err != nil {
		t.Fatalf("compile calendar: %v", err)
	}
	return calendar
}

func weeklyRaw(day string, start, end string) RawCalendar {
	return RawCalendar{
		Timezone:        "UTC",
		WeeklyIntervals: map[string][]ClockInterval{day: {{Start: start, End: end}}},
	}
}

func TestElapsedExclusive(t *testing.T) {
	monday := time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC)
	base := compileCalendar(t, weeklyRaw("monday", "09:00", "17:00"))

	tests := []struct {
		name    string
		base    *Calendar
		exclude *Calendar
		from    time.Time
		to      time.Time
		want    time.Duration
	}{
		{
			name:    "identical calendars have no exclusive time",
			base:    base,
			exclude: compileCalendar(t, weeklyRaw("monday", "09:00", "17:00")),
			from:    monday,
			to:      monday.AddDate(0, 0, 1),
			want:    0,
		},
		{
			name:    "disjoint calendars keep the full base window",
			base:    base,
			exclude: compileCalendar(t, weeklyRaw("tuesday", "09:00", "17:00")),
			from:    monday,
			to:      monday.AddDate(0, 0, 1),
			want:    8 * time.Hour,
		},
		{
			name:    "exclude over the tail leaves the morning",
			base:    base,
			exclude: compileCalendar(t, weeklyRaw("monday", "12:00", "17:00")),
			from:    monday,
			to:      monday.AddDate(0, 0, 1),
			want:    3 * time.Hour,
		},
		{
			name:    "exclude over the head leaves the afternoon",
			base:    base,
			exclude: compileCalendar(t, weeklyRaw("monday", "09:00", "12:00")),
			from:    monday,
			to:      monday.AddDate(0, 0, 1),
			want:    5 * time.Hour,
		},
		{
			name:    "empty base has no exclusive time",
			base:    compileCalendar(t, RawCalendar{Timezone: "UTC", WeeklyIntervals: map[string][]ClockInterval{}}),
			exclude: base,
			from:    monday,
			to:      monday.AddDate(0, 0, 7),
			want:    0,
		},
		{
			name: "an exclude holiday restores the base window",
			base: base,
			exclude: compileCalendar(t, RawCalendar{
				Timezone:        "UTC",
				WeeklyIntervals: map[string][]ClockInterval{"monday": {{Start: "09:00", End: "17:00"}}},
				Holidays:        []Holiday{{Date: "2026-01-05", Name: "Closed"}},
			}),
			from: monday,
			to:   monday.AddDate(0, 0, 1),
			want: 8 * time.Hour,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := ElapsedExclusive(test.base, test.exclude, test.from, test.to)
			if got != test.want {
				t.Fatalf("ElapsedExclusive = %v, want %v", got, test.want)
			}
		})
	}
}

func TestElapsedUnionAndWeeklyCoverage(t *testing.T) {
	monday := time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC)
	morning := compileCalendar(t, weeklyRaw("monday", "09:00", "12:00"))
	afternoon := compileCalendar(t, weeklyRaw("monday", "13:00", "17:00"))
	wider := compileCalendar(t, weeklyRaw("monday", "09:00", "17:00"))

	got := ElapsedUnion([]*Calendar{morning, afternoon}, monday, monday.AddDate(0, 0, 1))
	if want := 7 * time.Hour; got != want {
		t.Fatalf("ElapsedUnion = %v, want %v", got, want)
	}

	// Wider SLA vs two disjoint reference windows: 8h SLA, 7h team, 7h overlap.
	sla, team, overlap := WeeklyCoverage(wider, []*Calendar{morning, afternoon})
	if sla != 8*time.Hour || team != 7*time.Hour || overlap != 7*time.Hour {
		t.Fatalf("WeeklyCoverage = (%v, %v, %v), want (8h, 7h, 7h)", sla, team, overlap)
	}

	if !ReferencesWithinCalendarHours([]*Calendar{morning, afternoon}, monday.Add(10*time.Hour)) {
		t.Fatal("expected the union to be open at 10:00")
	}
	if ReferencesWithinCalendarHours([]*Calendar{morning, afternoon}, monday.Add(12*time.Hour+30*time.Minute)) {
		t.Fatal("expected the union to be closed at 12:30")
	}
}
