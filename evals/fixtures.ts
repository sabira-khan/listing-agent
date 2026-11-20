import { svgToPng } from '../src/ad'

export function certificatePng(): Buffer {
  const rows = [
    ['Certificate no.', '778812-B'],
    ['District', 'Harbor Point'],
    ['Phase', 'A2'],
    ['Plot no.', '2508'],
    ['Area', '801 m²'],
    ['Registered owner', 'Huda Saleh'],
    ['Issued', '12 March 2024']
  ]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="640" font-family="Georgia, Times New Roman, serif">
<rect width="900" height="640" fill="#fbf7ec"/>
<rect x="20" y="20" width="860" height="600" fill="none" stroke="#7a6a48" stroke-width="4"/>
<text x="450" y="95" font-size="34" text-anchor="middle" fill="#3b3222">PLOT OWNERSHIP CERTIFICATE</text>
<text x="450" y="132" font-size="18" text-anchor="middle" fill="#7a6a48">Sample document for testing</text>
${rows.map(([k, v], i) => `<text x="90" y="${205 + i * 54}" font-size="24" fill="#5a4e36">${k}</text><text x="420" y="${205 + i * 54}" font-size="26" font-weight="700" fill="#2b2418">${v}</text>`).join('\n')}
</svg>`
  return svgToPng(svg)
}
