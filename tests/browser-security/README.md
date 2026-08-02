# Browser Security

This suite is intentionally limited to four boundaries whose oracle is independent of UI implementation:

1. unauthenticated workspace/API denial;
2. persistent session identity recovery;
3. cross-user project isolation;
4. cross-project WorkspaceResource tree denial.

It is not a product journey framework. Do not add creative workflows, model/provider fixtures, UI snapshots, scenario registries, or general regression cases here. New cases require the security admission rule in `docs/architecture/modules/test-governance.md`.
