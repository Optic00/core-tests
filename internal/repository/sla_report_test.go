//go:build test

package repository

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"windshift/internal/cql"
	"windshift/internal/database"
	"windshift/internal/models"
	"windshift/internal/testutils"
)

func (f *slaFixture) insertCycle(t *testing.T, cycle *models.ItemSLACycle) int64 {
	t.Helper()
	var id int64
	err := database.WithTx(f.db, func(tx database.Tx) error {
		inserted, err := f.repo.InsertCycle(context.Background(), tx, cycle)
		id = inserted
		return err
	})
	if err != nil {
		t.Fatalf("insert cycle: %v", err)
	}
	return id
}

func (f *slaFixture) insertItem(t *testing.T, number int) int {
	t.Helper()
	var id int
	if err := f.db.QueryRow(`INSERT INTO items (workspace_id, workspace_item_number, title, description, frac_index) VALUES (?, ?, 'Second', '', ?) RETURNING id`,
		f.workspaceID, number, testutils.NextTestFracIndex()).Scan(&id); err != nil {
		t.Fatalf("insert item: %v", err)
	}
	return id
}

func completedCycle(itemID, metricID, cycleNo int, breached bool, stoppedAt time.Time) *models.ItemSLACycle {
	breachedAt := (*time.Time)(nil)
	if breached {
		breachedAt = &stoppedAt
	}
	elapsed := int64(1_000)
	if breached {
		elapsed = 2_000
	}
	return &models.ItemSLACycle{
		ItemID: itemID, MetricID: metricID, CycleNo: cycleNo, Status: models.SLACycleCompleted,
		StartedAt: stoppedAt.Add(-time.Hour), StoppedAt: &stoppedAt,
		GoalDurationMs: 1_000, ElapsedMs: elapsed, RemainingMs: 1_000 - elapsed,
		LastCalculatedAt: stoppedAt, Origin: models.SLAOriginNative,
		CalendarSnapshot: json.RawMessage(`{}`), GoalQuerySnapshot: "1 = 1",
		BreachedAt: breachedAt, Breached: breached,
	}
}

func TestSLAReportAggregatesCompletedAndBreachedCycles(t *testing.T) {
	fixture := newSLAFixture(t)
	ctx := context.Background()
	metricID := fixture.createMetric(t)
	stopped := time.Date(2025, 1, 8, 12, 0, 0, 0, time.UTC)

	fixture.insertCycle(t, completedCycle(fixture.itemID, metricID, 1, true, stopped))
	fixture.insertCycle(t, completedCycle(fixture.itemID, metricID, 2, false, stopped.Add(time.Hour)))

	secondItem := fixture.insertItem(t, 2)
	ongoing := &models.ItemSLACycle{
		ItemID: secondItem, MetricID: metricID, CycleNo: 1, Status: models.SLACycleOngoing,
		StartedAt: stopped, LastCalculatedAt: stopped, GoalDurationMs: 3_600_000, RemainingMs: 3_600_000,
		Origin: models.SLAOriginNative, CalendarSnapshot: json.RawMessage(`{}`), GoalQuerySnapshot: "1 = 1",
	}
	fixture.insertCycle(t, ongoing)

	report, err := fixture.repo.SLAReport(ctx, fixture.workspaceID, nil, nil)
	if err != nil {
		t.Fatalf("SLAReport: %v", err)
	}
	if len(report.Metrics) != 1 {
		t.Fatalf("report metrics = %#v", report.Metrics)
	}
	metric := report.Metrics[0]
	if metric.MetricID != metricID || metric.Completed != 2 || metric.Breached != 1 || metric.Ongoing != 1 {
		t.Fatalf("report metric = %#v", metric)
	}
	if metric.AvgElapsedMs == nil || *metric.AvgElapsedMs != 1_500 {
		t.Fatalf("avg elapsed = %v, want 1500", metric.AvgElapsedMs)
	}
	if len(report.BreachedItems) != 1 {
		t.Fatalf("breached items = %#v, want one", report.BreachedItems)
	}
	if report.BreachedItems[0].ItemKey != "SLAT-1" {
		t.Fatalf("breached item key = %q, want SLAT-1", report.BreachedItems[0].ItemKey)
	}
}

func TestSLAReportDateRangeFiltersCompletedCycles(t *testing.T) {
	fixture := newSLAFixture(t)
	metricID := fixture.createMetric(t)
	early := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)
	late := time.Date(2025, 2, 1, 12, 0, 0, 0, time.UTC)
	fixture.insertCycle(t, completedCycle(fixture.itemID, metricID, 1, true, early))
	fixture.insertCycle(t, completedCycle(fixture.itemID, metricID, 2, false, late))

	from := time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC)
	to := time.Date(2025, 3, 1, 0, 0, 0, 0, time.UTC)
	report, err := fixture.repo.SLAReport(context.Background(), fixture.workspaceID, &from, &to)
	if err != nil {
		t.Fatalf("SLAReport: %v", err)
	}
	if len(report.Metrics) != 1 || report.Metrics[0].Completed != 1 || report.Metrics[0].Breached != 0 {
		t.Fatalf("filtered report = %#v", report.Metrics)
	}
}

func TestSLAQLPredicateFiltersItems(t *testing.T) {
	fixture := newSLAFixture(t)
	ctx := context.Background()
	metricID := fixture.createMetric(t)
	now := time.Date(2025, 1, 8, 12, 0, 0, 0, time.UTC)

	// Item 1 is breached; item 2 has no cycles.
	breachedAt := now
	fixture.insertCycle(t, &models.ItemSLACycle{
		ItemID: fixture.itemID, MetricID: metricID, CycleNo: 1, Status: models.SLACycleOngoing,
		StartedAt: now.Add(-time.Hour), LastCalculatedAt: now, GoalDurationMs: 1000, ElapsedMs: 2000,
		RemainingMs: -1000, BreachedAt: &breachedAt, Breached: true,
		Origin: models.SLAOriginNative, CalendarSnapshot: json.RawMessage(`{}`), GoalQuerySnapshot: "1 = 1",
	})
	other := fixture.insertItem(t, 2)

	sqlText, args := generatedSLAPredicate(t, "slaBreached = true", now)
	query := `SELECT i.id ` + ItemListFilterFromClause() + ` WHERE ` + sqlText
	rows, err := fixture.db.QueryContext(ctx, query, args...)
	if err != nil {
		t.Fatalf("run SLA predicate: %v", err)
	}
	defer func() { _ = rows.Close() }()
	got := map[int]bool{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan id: %v", err)
		}
		got[id] = true
	}
	if !got[fixture.itemID] {
		t.Fatalf("breached item missing from result %v", got)
	}
	if got[other] {
		t.Fatalf("item without cycles matched slaBreached: %v", got)
	}
}

func generatedSLAPredicate(t *testing.T, query string, now time.Time) (string, []any) {
	t.Helper()
	tokens, err := cql.NewTokenizer(query).Tokenize()
	if err != nil {
		t.Fatalf("tokenize: %v", err)
	}
	ast, err := cql.NewParser(tokens).Parse()
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	generator := cql.NewSQLGenerator(map[string]int{}, nil, "sqlite")
	sqlText, args, err := generator.GenerateSQLAt(ast, now)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	return sqlText, args
}

func TestSLAQLDeadlineWindowFiltersItems(t *testing.T) {
	fixture := newSLAFixture(t)
	ctx := context.Background()
	metricID := fixture.createMetric(t)
	now := time.Date(2025, 1, 8, 12, 0, 0, 0, time.UTC)

	soon := now.Add(time.Hour)
	far := now.Add(5 * 24 * time.Hour)
	fixture.insertCycle(t, &models.ItemSLACycle{
		ItemID: fixture.itemID, MetricID: metricID, CycleNo: 1, Status: models.SLACycleOngoing,
		StartedAt: now.Add(-time.Hour), LastCalculatedAt: now, GoalDurationMs: 3_600_000, RemainingMs: 1,
		NextDeadlineAt: &soon, Origin: models.SLAOriginNative,
		CalendarSnapshot: json.RawMessage(`{}`), GoalQuerySnapshot: "1 = 1",
	})
	other := fixture.insertItem(t, 2)
	fixture.insertCycle(t, &models.ItemSLACycle{
		ItemID: other, MetricID: metricID, CycleNo: 1, Status: models.SLACycleOngoing,
		StartedAt: now.Add(-time.Hour), LastCalculatedAt: now, GoalDurationMs: 3_600_000, RemainingMs: 1,
		NextDeadlineAt: &far, Origin: models.SLAOriginNative,
		CalendarSnapshot: json.RawMessage(`{}`), GoalQuerySnapshot: "1 = 1",
	})

	sqlText, args := generatedSLAPredicate(t, "slaRunning = true AND slaDeadline <= 2d", now)
	rows, err := fixture.db.QueryContext(ctx, `SELECT i.id `+ItemListFilterFromClause()+` WHERE `+sqlText, args...)
	if err != nil {
		t.Fatalf("run SLA deadline predicate: %v", err)
	}
	defer func() { _ = rows.Close() }()
	got := map[int]bool{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan id: %v", err)
		}
		got[id] = true
	}
	if !got[fixture.itemID] {
		t.Fatalf("soon-deadline item missing from %v", got)
	}
	if got[other] {
		t.Fatalf("far-deadline item matched the window: %v", got)
	}
}
