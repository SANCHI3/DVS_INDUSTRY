# Paper

- [paper.md](paper.md): the paper in Markdown (renders on GitHub).
- [latex/paper.tex](latex/paper.tex): IEEE conference version (`IEEEtran` class).
- [make_pipeline_figure.py](make_pipeline_figure.py): draws `figures/pipeline.{png,pdf}` (Fig. 1).

Every number in the paper is copied from [../RESULTS.md](../RESULTS.md) or
[../results/](../results/), which the scripts in `perception-service/evaluation/`
generate. Items marked *[verify]* (affiliation, some reference details and
dataset sources) must be checked before submission.

## Building the PDF

No LaTeX toolchain is needed in the repository. The simplest route is to upload
the `docs/paper/latex/` folder together with `docs/paper/figures/` and
`docs/figures/` to Overleaf and keep the relative layout. Locally (TeX Live or
MiKTeX, which include `IEEEtran`):

```bash
cd docs/paper/latex
pdflatex paper && pdflatex paper
```

The `.tex` file has not been compiled in this repository (no TeX installation
was available); environments, references and citations were checked by script.
