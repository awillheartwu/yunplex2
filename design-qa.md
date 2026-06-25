# Dashboard Design QA

- Source visual truth path: `/Users/wuhaoli/Library/Caches/WeType/dsclp/1781169801333.png`
- Implementation screenshot path: `/private/tmp/reyunplex-dashboard-qa-top.png`
- Additional implementation screenshot path: `/private/tmp/reyunplex-dashboard-qa-bottom.png`
- Viewport: desktop web, `http://localhost:3001/`
- State: dashboard default state, light theme, loaded data, idle sync state
- Full-view comparison evidence: top screenshot used for header, toolbar, KPI grid, trend card, and three content panels; bottom screenshot used for source health placement and CTA structure
- Focused region comparison evidence: needed for two areas
  - Header and toolbar: checked title placement, sidebar/topbar divider alignment, status chips, last-sync text, auto-sync toggle, and primary CTA
  - KPI cards and source health: checked 2x2 KPI layout, large-number line breaks, unified section-title hierarchy, removal of the extra `更多`, and placement of `查看同步源管理`

**Findings**
- No actionable P0, P1, or P2 mismatches remain for the five requested homepage adjustments.

**Open Questions**
- None. The implemented state matches the provided design intent closely enough for handoff, while preserving current runtime data and existing interactions.

**Implementation Checklist**
- Align sidebar header and topbar height so the brand line and page-title line sit on the same baseline.
- Remove the duplicate in-content `仪表盘` title and convert the action row into a plain toolbar without the card pedestal.
- Normalize dashboard section-title typography through shared dashboard utility classes.
- Rebuild KPI cards so the large value sits on its own line and stays left-aligned inside the 2x2 grid.
- Move `查看同步源管理` into the source-health header and remove the redundant `更多` and footer CTA.
- Add unit coverage for dashboard time-format helpers and source-health percentage helpers.

**Follow-up Polish**
- P3: if you want an even tighter match later, the chart card can be widened a bit more at this viewport so its visual weight is closer to the mock.

**Patches Made Since The Previous QA Pass**
- Raised the global topbar height to align with the sidebar brand rail.
- Refactored the dashboard action strip into a lightweight toolbar with inline sync metadata.
- Introduced shared dashboard heading/link utility styles for stronger type consistency.
- Simplified source-health logic into reusable helper functions with tests.

final result: passed
