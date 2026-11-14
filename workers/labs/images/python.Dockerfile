# Build on the dedicated lab host after choosing a reviewed Python base digest.
ARG PYTHON_BASE
FROM ${PYTHON_BASE}
LABEL com.svans.lab.profile="python" com.svans.lab.version="1"
COPY --chown=0:0 --chmod=0444 workers/labs/images/launcher.py /opt/svans/launcher.py
USER 65532:65532
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/python3", "/opt/svans/launcher.py"]
