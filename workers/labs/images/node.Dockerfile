# Build on the dedicated lab host after choosing a reviewed Node base digest.
ARG NODE_BASE
FROM ${NODE_BASE}
LABEL com.svans.lab.profile="node" com.svans.lab.version="1"
COPY --chown=0:0 --chmod=0444 workers/labs/images/launcher.cjs /opt/svans/launcher.cjs
USER 65532:65532
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/node", "/opt/svans/launcher.cjs"]
