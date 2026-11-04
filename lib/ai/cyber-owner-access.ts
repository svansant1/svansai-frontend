function normalize(message: string): string {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const number = Number(part);
      return number >= 0 && number <= 255;
    })
  );
}

export function extractIpv4(message: string): string | null {
  const matches = message.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  return matches.find(isValidIpv4) ?? null;
}

export function isExplicitOwnerDeviceAccessRequest(message: string): boolean {
  const value = normalize(message);

  const ownership =
    /\b(my|mine|i own|i personally own|my own)\b/.test(value) &&
    /\b(laptop|computer|pc|desktop|server|vm|virtual machine|device|machine|network)\b/.test(
      value,
    );

  const authorized =
    /\b(authorized|authorised|permission to test|my lab|home lab|homelab|ctf)\b/.test(
      value,
    );

  const accessIntent =
    /\b(get in|get into|access|connect|remote|log in|login|enumerate|scan|hack|pentest|test)\b/.test(
      value,
    );

  return (ownership || authorized) && accessIntent;
}

export function buildOwnerDeviceAccessResponse(message: string): string | null {
  if (!isExplicitOwnerDeviceAccessRequest(message)) return null;

  const target = extractIpv4(message) ?? "<YOUR-LAPTOP-IP>";

  return [
    "Cyber Lab is active. Since you identified this as your own laptop, treat it as an authorized owner-device exercise.",
    "",
    "An IP address by itself does not create a remote login path. First find out which remote-management services your laptop is actually exposing.",
    "",
    "From another Windows machine on the same network, start with:",
    "",
    "```powershell",
    `$target = "${target}"`,
    "",
    "Test-NetConnection $target -Port 3389   # Remote Desktop",
    "Test-NetConnection $target -Port 22     # SSH",
    "Test-NetConnection $target -Port 5985   # WinRM / PowerShell remoting",
    "Test-NetConnection $target -Port 445    # SMB / Windows file sharing",
    "```",
    "",
    "If Nmap is installed, get service versions in one pass:",
    "",
    "```text",
    `nmap -Pn -sV -p 22,135,139,445,3389,5985,5986 ${target}`,
    "```",
    "",
    "Then follow the service that is actually open:",
    "",
    `- **3389 / RDP:** run \`mstsc /v:${target}\` and sign in with an account that is allowed to use Remote Desktop.`,
    `- **22 / SSH:** run \`ssh <your-windows-user>@${target}\` if OpenSSH Server is enabled on the laptop.`,
    `- **5985 / WinRM:** verify it with \`Test-WSMan ${target}\`, then use PowerShell remoting with your own credentials.`,
    `- **445 / SMB:** use \`net view \\\\${target}\` to see exposed shares. An administrator account can also access administrative shares when Windows policy and firewall rules permit it.`,
    "",
    "If all of those ports are closed, there is no normal network entry point to the machine just because you know its IP. At that point you need one of three things: enable a remote-management service locally, use an already-installed management agent, or use Windows account/recovery access at the machine.",
    "",
    "For an owner lab, the next cyber step is to enumerate what is listening first; once you have the Nmap or Test-NetConnection results, use those results to choose the exact access path instead of guessing.",
  ].join("\n");
}
