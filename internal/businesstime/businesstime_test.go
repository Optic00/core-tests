//go:build test

package businesstime

import (
	"encoding/json"
	"testing"
	"time"
)

func mustCompile(t *testing.T, raw RawCalendar) *Calendar {
	t.Helper()
	calendar, err := Compile(raw)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	return calendar
}

func weekdayCalendar(tz string) RawCalendar {
	weekday := []ClockInterval{{Start: "09:00", End: "17:00"}}
	return RawCalendar{
		Timezone: tz,
		WeeklyIntervals: map[string][]ClockInterval{
			"monday":    weekday,
			"tuesday":   weekday,
			"wednesday": weekday,
			"thursday":  weekday,
			"friday":    weekday,
		},
	}
}

func TestCompileRejectsInvalidInput(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		raw  RawCalendar
	}{
		{name: "unknown weekday", raw: RawCalendar{Timezone: "UTC", WeeklyIntervals: map[string][]ClockInterval{"funday": {{Start: "09:00", End: "10:00"}}}}},
		{name: "bad start clock", raw: RawCalendar{Timezone: "UTC", WeeklyIntervals: map[string][]ClockInterval{"monday": {{Start: "9", End: "10:00"}}}}},
		{name: "end before start", raw: RawCalendar{Timezone: "UTC", WeeklyIntervals: map[string][]ClockInterval{"monday": {{Start: "17:00", End: "09:00"}}}}},
		{name: "unknown zone", raw: RawCalendar{Timezone: "Mars/Olympus"}},
		{name: "bad holiday date", raw: RawCalendar{Timezone: "UTC", Holidays: []Holiday{{Date: "2024-13-40"}}}},
		{name: "bad recurring holiday", raw: RawCalendar{Timezone: "UTC", Holidays: []Holiday{{Recurring: true, MonthDay: "13-40"}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Compile(tc.raw); err == nil {
				t.Fatalf("expected an error for %s", tc.name)
			}
		})
	}
}

func TestCompileRejectsDuplicateWeekdaySpellings(t *testing.T) {
	t.Parallel()
	raw := RawCalendar{
		Timezone: "UTC",
		WeeklyIntervals: map[string][]ClockInterval{
			"mon":    {{Start: "09:00", End: "12:00"}},
			"monday": {{Start: "09:00", End: "12:00"}},
		},
	}
	if _, err := Compile(raw); err == nil {
		t.Fatal("expected duplicate weekday spellings to be rejected")
	}
}

func TestCompileMergesOverlappingIntervals(t *testing.T) {
	t.Parallel()
	raw := RawCalendar{
		Timezone: "UTC",
		WeeklyIntervals: map[string][]ClockInterval{
			"monday": {{Start: "09:00", End: "12:00"}, {Start: "10:00", End: "13:00"}},
		},
	}
	calendar := mustCompile(t, raw)
	from := time.Date(2025, 1, 6, 9, 0, 0, 0, time.UTC) // Monday
	wantDeadline := time.Date(2025, 1, 6, 13, 0, 0, 0, time.UTC)

	deadline, ok := calendar.AddCalendarTime(from, 4*time.Hour)
	if !ok {
		t.Fatal("expected a deadline")
	}
	if !deadline.Equal(wantDeadline) {
		t.Fatalf("deadline = %s, want %s", deadline, wantDeadline)
	}
	if got := calendar.ElapsedCalendarTime(from, wantDeadline); got != 4*time.Hour {
		t.Fatalf("elapsed = %s, want 4h (overlap must not double-count)", got)
	}
}

func TestAddCalendarTimeWithinOneDay(t *testing.T) {
	t.Parallel()
	calendar := mustCompile(t, weekdayCalendar("UTC"))
	// Wednesday 2025-01-08 09:00 UTC; a four-hour target lands at 13:00.
	from := time.Date(2025, 1, 8, 9, 0, 0, 0, time.UTC)
	deadline, ok := calendar.AddCalendarTime(from, 4*time.Hour)
	if !ok {
		t.Fatal("expected a deadline")
	}
	want := time.Date(2025, 1, 8, 13, 0, 0, 0, time.UTC)
	if !deadline.Equal(want) {
		t.Fatalf("deadline = %s, want %s", deadline, want)
	}
}

func TestAddCalendarTimeSkipsWeekend(t *testing.T) {
	t.Parallel()
	calendar := mustCompile(t, weekdayCalendar("UTC"))
	// Friday 2025-01-10 16:00 + 2h: one hour Friday, then Monday 09:00-10:00.
	from := time.Date(2025, 1, 10, 16, 0, 0, 0, time.UTC)
	deadline, ok := calendar.AddCalendarTime(from, 2*time.Hour)
	if !ok {
		t.Fatal("expected a deadline")
	}
	want := time.Date(2025, 1, 13, 10, 0, 0, 0, time.UTC)
	if !deadline.Equal(want) {
		t.Fatalf("deadline = %s, want %s", deadline, want)
	}
}

func TestAddCalendarTimeOutsideHoursStartsNextOpening(t *testing.T) {
	t.Parallel()
	calendar := mustCompile(t, weekdayCalendar("UTC"))
	from := time.Date(2025, 1, 8, 20, 0, 0, 0, time.UTC) // Wednesday evening
	deadline, ok := calendar.AddCalendarTime(from, 30*time.Minute)
	if !ok {
		t.Fatal("expected a deadline")
	}
	want := time.Date(2025, 1, 9, 9, 30, 0, 0, time.UTC)
	if !deadline.Equal(want) {
		t.Fatalf("deadline = %s, want %s", deadline, want)
	}
}

func TestAddCalendarTimeEmptyCalendarReturnsNotOK(t *testing.T) {
	t.Parallel()
	calendar := mustCompile(t, RawCalendar{Timezone: "UTC"})
	from := time.Date(2025, 1, 8, 9, 0, 0, 0, time.UTC)
	if _, ok := calendar.AddCalendarTime(from, time.Hour); ok {
		t.Fatal("expected ok = false for a calendar that never opens")
	}
}

func TestAddCalendarTimeClosedForeverReturnsNotOK(t *testing.T) {
	t.Parallel()
	raw := weekdayCalendar("UTC")
	// Close the calendar with recurring holidays for every possible month-day,
	// using a leap year so February 29 is covered too.
	raw.Holidays = nil
	for day := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC); day.Year() == 2000; day = day.AddDate(0, 0, 1) {
		raw.Holidays = append(raw.Holidays, Holiday{Recurring: true, MonthDay: day.Format("01-02")})
	}
	calendar := mustCompile(t, raw)
	from := time.Date(2025, 1, 8, 9, 0, 0, 0, time.UTC)
	if _, ok := calendar.AddCalendarTime(from, time.Hour); ok {
		t.Fatal("expected ok = false when every day is a holiday")
	}
}

func TestElapsedCalendarTimePartialAndFullWeek(t *testing.T) {
	t.Parallel()
	calendar := mustCompile(t, weekdayCalendar("UTC"))
	cases := []struct {
		name string
		from time.Time
		to   time.Time
		want time.Duration
	}{
		{
			name: "same day partial",
			from: time.Date(2025, 1, 8, 10, 0, 0, 0, time.UTC),
			to:   time.Date(2025, 1, 8, 12, 30, 0, 0, time.UTC),
			want: 150 * time.Minute,
		},
		{
			name: "after hours contributes nothing",
			from: time.Date(2025, 1, 8, 18, 0, 0, 0, time.UTC),
			to:   time.Date(2025, 1, 8, 20, 0, 0, 0, time.UTC),
			want: 0,
		},
		{
			name: "crosses a weekend",
			from: time.Date(2025, 1, 10, 16, 0, 0, 0, time.UTC), // Fri 16:00
			to:   time.Date(2025, 1, 13, 10, 0, 0, 0, time.UTC), // Mon 10:00
			want: 2 * time.Hour,
		},
		{
			name: "full work week",
			from: time.Date(2025, 1, 6, 9, 0, 0, 0, time.UTC),
			to:   time.Date(2025, 1, 11, 0, 0, 0, 0, time.UTC),
			want: 40 * time.Hour,
		},
		{
			name: "reversed range is zero",
			from: time.Date(2025, 1, 8, 12, 0, 0, 0, time.UTC),
			to:   time.Date(2025, 1, 8, 10, 0, 0, 0, time.UTC),
			want: 0,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := calendar.ElapsedCalendarTime(tc.from, tc.to); got != tc.want {
				t.Fatalf("elapsed = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestElapsedCalendarTimeLongRangeMatchesDayWalk(t *testing.T) {
	t.Parallel()
	raw := weekdayCalendar("UTC")
	raw.Holidays = []Holiday{
		{Date: "2025-02-17"},
		{Date: "2025-03-15"}, // Saturday, already non-working
		{Recurring: true, MonthDay: "12-25"},
	}
	calendar := mustCompile(t, raw)
	from := time.Date(2025, 1, 6, 9, 0, 0, 0, time.UTC)
	to := time.Date(2025, 12, 31, 17, 0, 0, 0, time.UTC)

	// Reference: walk every day and sum the real working overlap explicitly.
	want := time.Duration(0)
	for day := dayAtMidnight(from); day.Before(to); day = day.AddDate(0, 0, 1) {
		start, end := day, day.AddDate(0, 0, 1)
		if start.Before(from) {
			start = from
		}
		if end.After(to) {
			end = to
		}
		if end.After(start) {
			want += calendar.businessOnDay(start, end)
		}
	}
	got := calendar.ElapsedCalendarTime(from, to)
	if got != want {
		t.Fatalf("elapsed = %s, want %s", got, want)
	}
}

func TestElapsedCalendarTimeSubtractsHolidaysInFullWeeks(t *testing.T) {
	t.Parallel()
	raw := weekdayCalendar("UTC")
	raw.Holidays = []Holiday{{Date: "2025-01-15"}} // Wednesday
	calendar := mustCompile(t, raw)
	from := time.Date(2025, 1, 6, 0, 0, 0, 0, time.UTC)
	to := time.Date(2025, 1, 20, 0, 0, 0, 0, time.UTC)
	want := 72 * time.Hour // two weeks of 40h minus one 8h holiday
	if got := calendar.ElapsedCalendarTime(from, to); got != want {
		t.Fatalf("elapsed = %s, want %s", got, want)
	}
}

func TestWithinCalendarHours(t *testing.T) {
	t.Parallel()
	calendar := mustCompile(t, weekdayCalendar("UTC"))
	cases := []struct {
		name    string
		instant time.Time
		want    bool
	}{
		{name: "inside", instant: time.Date(2025, 1, 8, 9, 30, 0, 0, time.UTC), want: true},
		{name: "start boundary inclusive", instant: time.Date(2025, 1, 8, 9, 0, 0, 0, time.UTC), want: true},
		{name: "end boundary exclusive", instant: time.Date(2025, 1, 8, 17, 0, 0, 0, time.UTC), want: false},
		{name: "weekend", instant: time.Date(2025, 1, 11, 10, 0, 0, 0, time.UTC), want: false},
		{name: "holiday", instant: time.Date(2025, 1, 15, 10, 0, 0, 0, time.UTC), want: false},
	}
	holidayCalendar := mustCompile(t, RawCalendar{
		Timezone:        "UTC",
		WeeklyIntervals: weekdayCalendar("UTC").WeeklyIntervals,
		Holidays:        []Holiday{{Date: "2025-01-15"}},
	})
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := calendar.WithinCalendarHours(tc.instant)
			if tc.name == "holiday" {
				got = holidayCalendar.WithinCalendarHours(tc.instant)
			}
			if got != tc.want {
				t.Fatalf("WithinCalendarHours(%s) = %v, want %v", tc.instant, got, tc.want)
			}
		})
	}
}

func TestTimezoneAndSplitShifts(t *testing.T) {
	t.Parallel()
	// New York calendar with a split shift. 2025-01-08 12:00 UTC is
	// 07:00 EST, outside the first shift but before the second.
	raw := RawCalendar{
		Timezone: "America/New_York",
		WeeklyIntervals: map[string][]ClockInterval{
			"wednesday": {{Start: "08:00", End: "12:00"}, {Start: "13:00", End: "17:00"}},
		},
	}
	calendar := mustCompile(t, raw)
	morning := time.Date(2025, 1, 8, 13, 0, 0, 0, time.UTC) // 08:00 EST
	if !calendar.WithinCalendarHours(morning) {
		t.Fatal("expected 08:00 EST to be within the first shift")
	}
	lunch := time.Date(2025, 1, 8, 17, 0, 0, 0, time.UTC) // 12:00 EST
	if calendar.WithinCalendarHours(lunch) {
		t.Fatal("expected 12:00 EST to be outside the split shift")
	}
	from := time.Date(2025, 1, 8, 13, 0, 0, 0, time.UTC)
	deadline, ok := calendar.AddCalendarTime(from, 8*time.Hour)
	if !ok {
		t.Fatal("expected a deadline")
	}
	// 4h morning + 4h afternoon; afternoon ends 17:00 EST = 22:00 UTC.
	want := time.Date(2025, 1, 8, 22, 0, 0, 0, time.UTC)
	if !deadline.Equal(want) {
		t.Fatalf("deadline = %s, want %s", deadline, want)
	}
}

func TestDaylightSavingTransition(t *testing.T) {
	t.Parallel()
	// US spring forward 2025-03-09: 02:00-03:00 does not exist. A shift of
	// 08:00-12:00 still counts as four business hours.
	raw := RawCalendar{
		Timezone: "America/New_York",
		WeeklyIntervals: map[string][]ClockInterval{
			"sunday": {{Start: "08:00", End: "12:00"}},
		},
	}
	calendar := mustCompile(t, raw)
	from := time.Date(2025, 3, 9, 8, 0, 0, 0, time.UTC) // 03:00 EST before transition
	to := time.Date(2025, 3, 9, 16, 0, 0, 0, time.UTC)  // 12:00 EDT
	if got := calendar.ElapsedCalendarTime(from, to); got != 4*time.Hour {
		t.Fatalf("spring-forward elapsed = %s, want 4h", got)
	}

	// US fall back 2025-11-02: 01:00-02:00 occurs twice. The 09:00-12:00
	// shift counts as three business hours.
	raw.WeeklyIntervals = map[string][]ClockInterval{
		"sunday": {{Start: "09:00", End: "12:00"}},
	}
	calendar = mustCompile(t, raw)
	from = time.Date(2025, 11, 2, 13, 0, 0, 0, time.UTC) // 09:00 EDT
	to = time.Date(2025, 11, 2, 17, 0, 0, 0, time.UTC)   // 12:00 EST
	if got := calendar.ElapsedCalendarTime(from, to); got != 3*time.Hour {
		t.Fatalf("fall-back elapsed = %s, want 3h", got)
	}
}

func TestElapsedCalendarTimeCountsTransitionInTrailingPartialWeek(t *testing.T) {
	t.Parallel()
	// The interior whole-week arithmetic ends before the clock transition, so
	// the DST adjustment must also sample the final partial week. A 9-day range
	// across the US transition loses an hour on spring forward and gains one on
	// fall back relative to the nominal nine days.
	calendar := mustCompile(t, AlwaysOpenRaw("America/New_York"))
	ny := calendar.Location()
	cases := []struct {
		name string
		from time.Time
		to   time.Time
		want time.Duration
	}{
		{
			name: "spring forward in trailing week",
			from: time.Date(2026, 3, 7, 12, 0, 0, 0, ny),
			to:   time.Date(2026, 3, 16, 12, 0, 0, 0, ny),
			want: 215 * time.Hour,
		},
		{
			name: "fall back in trailing week",
			from: time.Date(2026, 10, 31, 12, 0, 0, 0, ny),
			to:   time.Date(2026, 11, 9, 12, 0, 0, 0, ny),
			want: 217 * time.Hour,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := calendar.ElapsedCalendarTime(tc.from, tc.to); got != tc.want {
				t.Fatalf("elapsed = %s, want %s", got, tc.want)
			}
			// AddCalendarTime must invert the elapsed duration exactly.
			deadline, ok := calendar.AddCalendarTime(tc.from, tc.want)
			if !ok {
				t.Fatal("AddCalendarTime returned no deadline")
			}
			if !deadline.Equal(tc.to) {
				t.Fatalf("deadline = %s, want %s", deadline, tc.to)
			}
		})
	}
}

func TestElapsedCalendarTimeHandlesSkippedMidnight(t *testing.T) {
	t.Parallel()
	// Santiago starts DST by jumping 00:00 to 01:00 on 2026-09-06, so that
	// local midnight does not exist. Day boundaries must use the first valid
	// instant of the date; three days from noon to noon is 71h, not 72h.
	calendar := mustCompile(t, AlwaysOpenRaw("America/Santiago"))
	loc := calendar.Location()
	from := time.Date(2026, 9, 5, 12, 0, 0, 0, loc)
	to := time.Date(2026, 9, 8, 12, 0, 0, 0, loc)
	if got := calendar.ElapsedCalendarTime(from, to); got != 71*time.Hour {
		t.Fatalf("elapsed = %s, want 71h", got)
	}
	deadline, ok := calendar.AddCalendarTime(from, 71*time.Hour)
	if !ok || !deadline.Equal(to) {
		t.Fatalf("AddCalendarTime = %s/%v, want %s/true", deadline, ok, to)
	}
}

func TestElapsedCalendarTimeResolvesIntervalEndInDSTGap(t *testing.T) {
	t.Parallel()
	// US spring forward 2026-03-08 skips 02:00-03:00. An interval endpoint
	// inside the gap advances to the first valid instant (03:00), so the
	// whole-week arithmetic matches the per-day walk and Elapsed/Add agree.
	cases := []struct {
		name     string
		interval ClockInterval
		fullWeek bool
		want     time.Duration
	}{
		{
			name:     "end inside gap for one day",
			interval: ClockInterval{Start: "00:00", End: "02:30"},
			want:     2 * time.Hour,
		},
		{
			name:     "end inside gap over a full week",
			interval: ClockInterval{Start: "00:00", End: "02:30"},
			fullWeek: true,
			want:     270 * time.Minute, // 2.5h on 03-01 plus 2h on 03-08
		},
		{
			name:     "interval spanning the gap for one day",
			interval: ClockInterval{Start: "01:00", End: "03:00"},
			want:     1 * time.Hour,
		},
		{
			name:     "interval spanning the gap over a full week",
			interval: ClockInterval{Start: "01:00", End: "03:00"},
			fullWeek: true,
			want:     3 * time.Hour, // 2h on 03-01 plus 1h on 03-08
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := RawCalendar{
				Timezone: "America/New_York",
				WeeklyIntervals: map[string][]ClockInterval{
					"sunday": {tc.interval},
				},
			}
			calendar := mustCompile(t, raw)
			loc := calendar.Location()
			from := time.Date(2026, 3, 8, 0, 0, 0, 0, loc)
			to := time.Date(2026, 3, 8, 3, 0, 0, 0, loc)
			if tc.fullWeek {
				from = time.Date(2026, 3, 1, 0, 0, 0, 0, loc)
				to = time.Date(2026, 3, 9, 0, 0, 0, 0, loc)
			}
			if got := calendar.ElapsedCalendarTime(from, to); got != tc.want {
				t.Fatalf("elapsed = %s, want %s", got, tc.want)
			}
			deadline, ok := calendar.AddCalendarTime(from, tc.want)
			if !ok {
				t.Fatal("AddCalendarTime returned no deadline")
			}
			if got := calendar.ElapsedCalendarTime(from, deadline); got != tc.want {
				t.Fatalf("elapsed to added deadline = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestNextOpening(t *testing.T) {
	t.Parallel()
	calendar := mustCompile(t, weekdayCalendar("UTC"))
	saturday := time.Date(2025, 1, 11, 10, 0, 0, 0, time.UTC)
	opening, ok := calendar.NextOpening(saturday)
	if !ok {
		t.Fatal("expected an opening")
	}
	want := time.Date(2025, 1, 13, 9, 0, 0, 0, time.UTC)
	if !opening.Equal(want) {
		t.Fatalf("opening = %s, want %s", opening, want)
	}
	openNow := time.Date(2025, 1, 8, 10, 0, 0, 0, time.UTC)
	if got, ok := calendar.NextOpening(openNow); !ok || !got.Equal(openNow) {
		t.Fatalf("NextOpening inside hours = %s/%v, want %s/true", got, ok, openNow)
	}
}

func TestParseRawDefaultIsAlwaysOpen(t *testing.T) {
	t.Parallel()
	calendar, err := CompileJSON("")
	if err != nil {
		t.Fatalf("CompileJSON: %v", err)
	}
	instant := time.Date(2025, 1, 11, 3, 0, 0, 0, time.UTC)
	if !calendar.WithinCalendarHours(instant) {
		t.Fatal("blank calendar should be 24/7")
	}
}

func TestRecurringHolidayEveryYear(t *testing.T) {
	t.Parallel()
	raw := weekdayCalendar("UTC")
	raw.Holidays = []Holiday{{Recurring: true, MonthDay: "12-25", Name: "Christmas"}}
	calendar := mustCompile(t, raw)
	for _, year := range []int{2025, 2026, 2027} {
		instant := time.Date(year, 12, 25, 10, 0, 0, 0, time.UTC)
		if calendar.WithinCalendarHours(instant) {
			t.Fatalf("expected %d-12-25 to be closed", year)
		}
	}
}

func TestElapsedCalendarTimeDeduplicatesRecurringAndDatedHoliday(t *testing.T) {
	t.Parallel()
	// The same date listed as both a concrete and a recurring holiday must be
	// subtracted once. Eight days contain five weekdays (40h) minus one 8h
	// holiday; a double subtraction would drop it to 27h.
	raw := weekdayCalendar("UTC")
	raw.Holidays = []Holiday{
		{Date: "2026-12-25"},
		{Recurring: true, MonthDay: "12-25"},
	}
	calendar := mustCompile(t, raw)
	from := time.Date(2026, 12, 20, 12, 0, 0, 0, time.UTC)
	to := time.Date(2026, 12, 28, 12, 0, 0, 0, time.UTC)
	if got := calendar.ElapsedCalendarTime(from, to); got != 35*time.Hour {
		t.Fatalf("elapsed = %s, want 35h", got)
	}
}

func TestElapsedCalendarTimeSkipsRecurringFeb29InNonLeapYear(t *testing.T) {
	t.Parallel()
	// A recurring 02-29 holiday does not exist in 2027, so the whole-week path
	// must not roll it onto Mar 1 and close a working day: five weekdays are
	// 40h, not 32h.
	raw := weekdayCalendar("UTC")
	raw.Holidays = []Holiday{{Recurring: true, MonthDay: "02-29"}}
	calendar := mustCompile(t, raw)
	from := time.Date(2027, 2, 28, 0, 0, 0, 0, time.UTC)
	to := time.Date(2027, 3, 8, 0, 0, 0, 0, time.UTC)
	if got := calendar.ElapsedCalendarTime(from, to); got != 40*time.Hour {
		t.Fatalf("elapsed = %s, want 40h", got)
	}
}

func TestFromStoredParsesBareCalendarColumns(t *testing.T) {
	t.Parallel()
	// working_calendars stores weekly_intervals as a bare weekday map and
	// holidays as a bare array, with timezone in its own column. Parsing them
	// as a full RawCalendar envelope silently produced an empty calendar and
	// therefore no deadlines.
	raw, err := FromStored("UTC",
		json.RawMessage(`{"monday":[{"start":"09:00","end":"17:00"}]}`),
		json.RawMessage(`[{"date":"2025-01-06"}]`),
	)
	if err != nil {
		t.Fatalf("FromStored: %v", err)
	}
	if len(raw.WeeklyIntervals["monday"]) != 1 || len(raw.Holidays) != 1 {
		t.Fatalf("raw = %#v", raw)
	}
	calendar, err := Compile(raw)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	start := time.Date(2025, 1, 6, 9, 0, 0, 0, time.UTC) // Monday, but a holiday
	if calendar.WithinCalendarHours(start) {
		t.Fatal("holiday Monday should be closed")
	}
	open := time.Date(2025, 1, 13, 10, 0, 0, 0, time.UTC) // Monday, not a holiday
	if !calendar.WithinCalendarHours(open) {
		t.Fatal("a non-holiday Monday should be open")
	}
}
