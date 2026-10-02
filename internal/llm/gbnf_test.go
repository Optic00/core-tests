package llm

import (
	"encoding/json"
	"strings"
	"testing"
	"fmt"
	"sort"
)

func TestJSONSchemaToGBNF_String(t *testing.T) {
	schema := json.RawMessage(`{"type": "string"}`)
	grammar, err := JSONSchemaToGBNF(schema)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(grammar, "root ::= string") {
		t.Errorf("expected root to reference string, got: %s", grammar)
	}
}

func TestJSONSchemaToGBNF_Integer(t *testing.T) {
	schema := json.RawMessage(`{"type": "integer"}`)
	grammar, err := JSONSchemaToGBNF(schema)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(grammar, "root ::= integer") {
		t.Errorf("expected root to reference integer, got: %s", grammar)
	}
}

func TestJSONSchemaToGBNF_Boolean(t *testing.T) {
	schema := json.RawMessage(`{"type": "boolean"}`)
	grammar, err := JSONSchemaToGBNF(schema)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(grammar, "root ::= boolean") {
		t.Errorf("expected root to reference boolean, got: %s", grammar)
	}
}

func TestJSONSchemaToGBNF_Object(t *testing.T) {
	schema := json.RawMessage(`{
		"type": "object",
		"properties": {
			"name": {"type": "string"},
			"age": {"type": "integer"}
		},
		"required": ["name", "age"]
	}`)
	grammar, err := JSONSchemaToGBNF(schema)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check it contains object structure with properties
	if !strings.Contains(grammar, `"{"`) {
		t.Errorf("expected object structure with braces, got: %s", grammar)
	}
	// Properties appear as escaped quotes in GBNF: "\"name\""
	if !strings.Contains(grammar, `\"name\"`) {
		t.Errorf("expected 'name' property, got: %s", grammar)
	}
	if !strings.Contains(grammar, `\"age\"`) {
		t.Errorf("expected 'age' property, got: %s", grammar)
	}
}

func TestJSONSchemaToGBNF_Array(t *testing.T) {
	schema := json.RawMessage(`{
		"type": "array",
		"items": {"type": "string"}
	}`)
	grammar, err := JSONSchemaToGBNF(schema)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check it contains array structure
	if !strings.Contains(grammar, `"["`) {
		t.Errorf("expected array structure with brackets, got: %s", grammar)
	}
}

func TestJSONSchemaToGBNF_Nested(t *testing.T) {
	schema := json.RawMessage(`{
		"type": "object",
		"properties": {
			"items": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"title": {"type": "string"}
					}
				}
			},
			"summary": {"type": "string"}
		}
	}`)
	grammar, err := JSONSchemaToGBNF(schema)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should have multiple rules
	lines := strings.Split(grammar, "\n")
	ruleCount := 0
	for _, line := range lines {
		if strings.Contains(line, "::=") {
			ruleCount++
		}
	}
	if ruleCount < 3 {
		t.Errorf("expected at least 3 rules for nested schema, got %d: %s", ruleCount, grammar)
	}
}

func TestJSONSchemaToGBNF_PlanMyDay(t *testing.T) {
	grammar, err := JSONSchemaToGBNF(SchemaPlanMyDay)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check for key elements (properties appear as escaped quotes in GBNF)
	if !strings.Contains(grammar, `\"activities\"`) {
		t.Errorf("expected 'activities' property, got: %s", grammar)
	}
	if !strings.Contains(grammar, `\"summary\"`) {
		t.Errorf("expected 'summary' property, got: %s", grammar)
	}
}

func TestJSONSchemaToGBNF_FindSimilar(t *testing.T) {
	grammar, err := JSONSchemaToGBNF(SchemaFindSimilar)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(grammar, `\"similar_items\"`) {
		t.Errorf("expected 'similar_items' property, got: %s", grammar)
	}
}

func TestJSONSchemaToGBNF_Decompose(t *testing.T) {
	grammar, err := JSONSchemaToGBNF(SchemaDecompose)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(grammar, `\"sub_tasks\"`) {
		t.Errorf("expected 'sub_tasks' property, got: %s", grammar)
	}
	if !strings.Contains(grammar, `\"reasoning\"`) {
		t.Errorf("expected 'reasoning' property, got: %s", grammar)
	}
}

func TestJSONSchemaToGBNF_InvalidSchema(t *testing.T) {
	schema := json.RawMessage(`{invalid json`)
	_, err := JSONSchemaToGBNF(schema)
	if err == nil {
		t.Error("expected error for invalid JSON schema")
	}
}

func TestJSONSchemaToGBNFEscapesEnumStrings(t *testing.T) {
	schema := json.RawMessage(`{
		"type": "string",
		"enum": ["a\"b\\c"]
	}`)

	grammar, err := JSONSchemaToGBNF(schema)
	if err != nil {
		t.Fatalf("JSONSchemaToGBNF returned error: %v", err)
	}

	if strings.Contains(grammar, `"a"b\c"`) {
		t.Fatalf("grammar contains unescaped enum literal: %s", grammar)
	}
	if !strings.Contains(grammar, `a\\\"b`) || !strings.Contains(grammar, `\\\\c`) {
		t.Fatalf("grammar does not contain escaped enum literal: %s", grammar)
	}
}

func TestJSONSchemaToGBNFAllowsOptionalObjectProperties(t *testing.T) {
	schema := json.RawMessage(`{
		"type": "object",
		"properties": {
			"required_field": { "type": "string" },
			"optional_field": { "type": "string" }
		},
		"required": ["required_field"],
		"additionalProperties": false
	}`)

	grammar, err := JSONSchemaToGBNF(schema)
	if err != nil {
		t.Fatalf("JSONSchemaToGBNF returned error: %v", err)
	}

	if !strings.Contains(grammar, `"\"required_field\"" ws ":" ws root_required_field`) {
		t.Fatalf("grammar does not allow required-only object: %s", grammar)
	}
	if !strings.Contains(grammar, `"\"optional_field\"" ws ":" ws root_optional_field`) ||
		!strings.Contains(grammar, `ws "," ws "\"required_field\""`) {
		t.Fatalf("grammar does not allow optional property object: %s", grammar)
	}
}

// JSONSchemaToGBNF converts a JSON Schema to GBNF grammar for llama.cpp.
// It handles primitives, objects, arrays, and required/additionalProperties constraints.
func JSONSchemaToGBNF(schema json.RawMessage) (string, error) {
	var s jsonSchema
	if err := json.Unmarshal(schema, &s); err != nil {
		return "", fmt.Errorf("failed to parse JSON schema: %w", err)
	}

	g := &gbnfGenerator{
		rules:     make(map[string]string),
		ruleOrder: []string{},
	}

	// Generate the root rule
	rootRule := g.generateRule("root", &s)
	g.addRule("root", rootRule)

	return g.String(), nil
}

// jsonSchema represents a subset of JSON Schema used for GBNF conversion.
type jsonSchema struct {
	Type                 string                 `json:"type"`
	Properties           map[string]*jsonSchema `json:"properties"`
	Required             []string               `json:"required"`
	AdditionalProperties *bool                  `json:"additionalProperties"`
	Items                *jsonSchema            `json:"items"`
	Enum                 []any                  `json:"enum"`
}

type gbnfGenerator struct {
	rules     map[string]string
	ruleOrder []string
	counter   int
}

func (g *gbnfGenerator) addRule(name, rule string) {
	if _, exists := g.rules[name]; !exists {
		g.rules[name] = rule
		g.ruleOrder = append(g.ruleOrder, name)
	}
}

func (g *gbnfGenerator) uniqueName(base string) string {
	g.counter++
	return fmt.Sprintf("%s%d", base, g.counter)
}

func (g *gbnfGenerator) String() string {
	lines := make([]string, 0, len(g.ruleOrder))

	// Add common rules first
	g.addCommonRules()

	for _, name := range g.ruleOrder {
		lines = append(lines, fmt.Sprintf("%s ::= %s", name, g.rules[name]))
	}
	return strings.Join(lines, "\n")
}

func (g *gbnfGenerator) addCommonRules() {
	// Whitespace
	g.addRule("ws", `[ \t\n\r]*`)

	// String: quoted with escape support
	g.addRule("string", `"\"" ([^"\\] | "\\" .)* "\""`)

	// Number types
	g.addRule("integer", `"-"? [0-9]+`)
	g.addRule("number", `"-"? [0-9]+ ("." [0-9]+)? ([eE] [+-]? [0-9]+)?`)

	// Boolean
	g.addRule("boolean", `"true" | "false"`)

	// Null
	g.addRule("null", `"null"`)
}

func (g *gbnfGenerator) generateRule(name string, s *jsonSchema) string {
	if s == nil {
		return "string" // default fallback
	}

	// Handle enum
	if len(s.Enum) > 0 {
		return g.generateEnum(s.Enum)
	}

	switch s.Type {
	case "string":
		return "string"
	case "integer":
		return "integer"
	case "number":
		return "number"
	case "boolean":
		return "boolean"
	case "null":
		return "null"
	case "object":
		return g.generateObject(name, s)
	case "array":
		return g.generateArray(name, s)
	default:
		// No type specified, allow any JSON value
		return "string"
	}
}

func (g *gbnfGenerator) generateEnum(values []any) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		encoded, err := json.Marshal(v)
		if err != nil {
			continue
		}
		parts = append(parts, grammarStringLiteral(string(encoded)))
	}
	if len(parts) == 0 {
		return "null"
	}
	return strings.Join(parts, " | ")
}

func (g *gbnfGenerator) generateObject(name string, s *jsonSchema) string {
	if len(s.Properties) == 0 {
		return `"{" ws "}"`
	}

	requiredSet := make(map[string]bool, len(s.Required))
	for _, r := range s.Required {
		requiredSet[r] = true
	}

	// Sort property names for deterministic output.
	propNames := make([]string, 0, len(s.Properties))
	for propName := range s.Properties {
		propNames = append(propNames, propName)
	}
	sort.Strings(propNames)

	// Generate rules for each property's value.
	propRules := make(map[string]string, len(propNames))
	for _, propName := range propNames {
		propSchema := s.Properties[propName]
		valueName := g.uniqueName(name + "_" + propName)
		valueRule := g.generateRule(valueName, propSchema)
		g.addRule(valueName, valueRule)

		propRules[propName] = fmt.Sprintf(`%s ws ":" ws %s`, jsonStringGrammarLiteral(propName), valueName)
	}

	body := renderObjectPropertySequence(propNames, propRules, requiredSet, 0, false)
	if body == "" {
		return `"{" ws "}"`
	}
	return fmt.Sprintf(`"{" ws %s ws "}"`, body)
}

func renderObjectPropertySequence(propNames []string, propRules map[string]string, requiredSet map[string]bool, index int, emitted bool) string {
	if index >= len(propNames) {
		return ""
	}

	propName := propNames[index]
	prefix := ""
	if emitted {
		prefix = ` ws "," ws `
	}
	take := prefix + propRules[propName]
	if rest := renderObjectPropertySequence(propNames, propRules, requiredSet, index+1, true); rest != "" {
		take += rest
	}
	if requiredSet[propName] {
		return take
	}

	skip := renderObjectPropertySequence(propNames, propRules, requiredSet, index+1, emitted)
	if skip == "" {
		return fmt.Sprintf(`(%s)?`, take)
	}
	return fmt.Sprintf(`(%s | %s)`, skip, take)
}

func jsonStringGrammarLiteral(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		encoded = []byte(`""`)
	}
	return grammarStringLiteral(string(encoded))
}

func grammarStringLiteral(value string) string {
	var b strings.Builder
	b.Grow(len(value) + 2)
	b.WriteByte('"')
	for _, r := range value {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

func (g *gbnfGenerator) generateArray(name string, s *jsonSchema) string {
	if s.Items == nil {
		// Array of any type
		return `"[" ws "]"` // empty array only
	}

	// Generate rule for array items
	itemName := g.uniqueName(name + "_item")
	itemRule := g.generateRule(itemName, s.Items)
	g.addRule(itemName, itemRule)

	// Array with at least one element, comma-separated
	// Format: [ item (, item)* ] or []
	return fmt.Sprintf(`"[" ws (%s (ws "," ws %s)*)? ws "]"`, itemName, itemName)
}
