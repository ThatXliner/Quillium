# Use Supabase accounts for collaboration identity

Use Supabase Auth accounts rather than license keys for Omni. Collaboration
needs durable user identity and email invitations, and account-based invitations
avoid building a separate identity system. See the
[issue #194 decision](https://github.com/ThatXliner/Quillium/issues/194#issuecomment-4265312312).
