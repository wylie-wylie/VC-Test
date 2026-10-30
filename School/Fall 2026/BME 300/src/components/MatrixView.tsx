import { BIOMARKERS, MATRIX, MATRIX_NOTE } from "../data/matrix"

export function MatrixView() {
  return (
    <section className="matrix-wrap">
      <header className="stage-head">
        <div>
          <h1>Wound biomarker matrix</h1>
          <p className="lede">
            What each marker means in the wound, the expected band, the abnormal band, and the therapy route.
          </p>
        </div>
      </header>
      <div className="table-scroll">
        <table className="matrix">
          <caption>Biomarkers</caption>
          <thead>
            <tr>
              <th>Biomarker</th>
              <th>What it means in the wound</th>
              <th>Normal range</th>
              <th>Abnormal range</th>
              <th>Therapy route</th>
              <th>Image</th>
            </tr>
          </thead>
          <tbody>
            {BIOMARKERS.map((row) => (
              <tr key={row.biomarker}>
                <td>
                  <strong>{row.biomarker}</strong>
                </td>
                <td>{row.meaning}</td>
                <td>{row.normal}</td>
                <td>{row.abnormal}</td>
                <td>{row.therapy}</td>
                <td>{row.image}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-label">Acquisition channels</h2>
      <p className="lede matrix-lead">
        These are how the handheld collects the wound around the biomarkers. They are not a second set of diagnostic cutoffs.
      </p>
      <div className="table-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Channel</th>
              <th>Envelope</th>
              <th>Expected</th>
              <th>Barrier signal</th>
              <th>Treatment option</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((row) => (
              <tr key={row.parameter}>
                <td>
                  <strong>{row.parameter}</strong>
                </td>
                <td>{row.channel}</td>
                <td>{row.envelope}</td>
                <td>{row.expected}</td>
                <td>{row.barrier}</td>
                <td>{row.treatment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="matrix-note">{MATRIX_NOTE}</p>
    </section>
  )
}
