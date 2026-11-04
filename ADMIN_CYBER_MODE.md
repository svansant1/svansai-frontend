# SVANS-AI Admin Cyber Mode

This release adds an owner-only expert cybersecurity teaching mode without requiring the unfinished larger response-engine refactor.

## Activation

The server requires both:

1. A Supabase session that matches `OWNER_USER_ID` or `OWNER_EMAIL`.
2. `SVANSAI_ADMIN_CYBER_MODE_ENABLED=1`.

When both are true, the chat shows a **Cyber Lab** toggle. Turning it on also switches the answer style to Direct.

## Intended scope

Cyber Lab is for the owner's own devices, local labs, CTFs, intentionally vulnerable applications, staging systems, and other explicitly authorized testing environments. In those contexts, SVANS is instructed to teach at expert depth, including concrete commands, code, exploit mechanics, privilege escalation, reverse engineering, malware analysis, and red/blue workflows when useful.

The mode does not treat an unrelated third-party system as automatically authorized. Hosted AI providers can also enforce their own independent policies.

## Fast disable

Set:

```text
SVANSAI_ADMIN_CYBER_MODE_ENABLED=0
```

and redeploy.

## Verification

Run:

```powershell
npm run test:cyber-mode
npm run build
```

Then sign in as the configured owner and verify the **Cyber Lab OFF/ON** control appears.
