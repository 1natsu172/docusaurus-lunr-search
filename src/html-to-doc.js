const { parentPort, workerData } = require('worker_threads')

// unified imports
const unified = require('unified')
const parse = require('rehype-parse')
const select = require('hast-util-select').select
const selectAll = require('hast-util-select').selectAll
const toText = require('hast-util-to-text')
const is = require('unist-util-is')
const toVfile = require('to-vfile')

const sectionHeaderTypes = ['h2', 'h3']

// Build search data for a html
function * scanDocuments({ path, url }) {
  let vfile
  try {
    vfile = toVfile.readSync(path)
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`docusaurus-lunr-search:: unable to read file ${path}`)
      console.error(e)
    }
    return
  }

  const hast = unified()
    .use(parse, { emitParseErrors: false })
    .parse(vfile)

  const article = select('article', hast)
  if (!article) {
    return
  }
  const markdown = select('.markdown', article)
  if (!markdown) {
    return
  }

  const pageTitleElement = select('h1', article)
  if (!pageTitleElement) {
    return
  }
  const pageTitle = toText(pageTitleElement)
  const sectionHeaders = getSectionHeaders(markdown)

  const keywords = selectAll('meta[name="keywords"]', hast).reduce((acc, metaNode) => {
    if (metaNode.properties.content) {
      return acc.concat(metaNode.properties.content.replace(/,/g, ' '))
    }
    return acc
  }, []).join(' ')

  yield {
    title: pageTitle,
    type: 0,
    sectionRef: '#',
    url,
    // If there is no sections then push the complete content under page title
    content: sectionHeaders.length === 0 ? getContent(markdown) : '',
    keywords,
  }

  for (const sectonDesc of sectionHeaders) {
    const { title, content, ref } = sectionDesc;
    yield {
      title,
      type: 1,
      pageTitle,
      url: `${url}#${ref}`,
      content,
    }
  }
}

function getContent(element) {
  return toText(element).replace(/\s\s+/g, ' ').replace(/(\r\n|\n|\r)/gm, ' ')
}

function getSectionHeaders(markdown) {
  let currentSection = null
  const result = []
  let contentsAcc = ''

  const emitCurrent = () => {
    result.push({
      title: toText(currentSection).replace(/^#+/, ''),
      ref: select('.anchor', currentSection).properties.id,
      content: contentsAcc,
    })
    contentsAcc = ''
    currentSection = null
  }

  for (const node of markdown.children) {
    if (is(node, sectionHeaderTypes)) {
      if (currentSection) {
        emitCurrent()
      }
      currentSection = node
    } else if (currentSection) {
      contentsAcc += getContent(node) + ' '
    }
  }
  if (currentSection) {
    emitCurrent()
  }

  return result
}

function processFile(file) {
  for (const doc of scanDocuments(file)) {
    parentPort.postMessage(doc)
  }
  parentPort.postMessage(null)
}

parentPort.on('message', (maybeFile) => {
  if (maybeFile) {
    processFile(maybeFile)
  } else {
    parentPort.close()
  }
})
