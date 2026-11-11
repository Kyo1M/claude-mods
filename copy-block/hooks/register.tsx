import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import { splitBlocks } from './blocks'

/** 返答の 1 行目に付く「⏺ 」の幅。2 つ目以降の区切りをこの分だけ下げる */
const BULLET_COLUMNS = 2

async function copyBlock($: EngineInterface, body: string, surface: RenderSurface): Promise<void> {
  const result = await $.ui.copy({ text: body, surface })
  const rows = body.split('\n').length
  $.ui.toast(result.isCopied ? `コピーしました(${rows}行)` : 'コピーできませんでした')
}

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage', surface: 'terminal' }, async ($, e, next) => {
    // 要約の行は本文そのものではないので、標準の描画に任せる
    if (e.props.isSummary) return next(e)

    const segments = splitBlocks(e.props.text)
    if (!segments.some(segment => segment.kind === 'block')) return next(e)

    const { Box, Button } = $.ui.resolve(e)
    const rows = []
    for (const [index, segment] of segments.entries()) {
      // 区切りごとに本体の描画へ渡す。「⏺」を描くのは最初の区切りだけにする
      const isFirst = index === 0 && e.props.isFirstOfReply
      const drawn = await next({ ...e, props: { ...e.props, text: segment.raw, isFirstOfReply: isFirst } })
      const paddingLeft = e.props.isFirstOfReply && index > 0 ? BULLET_COLUMNS : 0

      if (segment.kind === 'text') {
        rows.push(<Box paddingLeft={paddingLeft}>{drawn}</Box>)
        continue
      }

      const { body } = segment
      rows.push(
        <Box key={`block-${index}`} flexDirection="column" paddingLeft={paddingLeft}>
          {drawn}
          {/* 本体の描画は上に空行を 1 行持つので、その右端に重ねる */}
          <Box position="absolute" top={0} right={0}>
            <Button
              key={`copy-${index}`}
              label="⧉"
              plain
              dimColor
              onPress={press => {
                void copyBlock($, body, press.surface).catch(() => $.ui.toast('コピーできませんでした'))
              }}
            />
          </Box>
        </Box>,
      )
    }

    return <Box flexDirection="column">{rows}</Box>
  })
}
