package orchescala.helper.dev
package company

import orchescala.helper.dev.update.{doNotAdjustText, howToResetText}

export orchescala.helper.util.DevConfig
export orchescala.helper.util.ModuleConfig

private val replaceHelperCompanyCommand ="./helperCompany.scala init"
lazy val helperCompanyDoNotAdjustText = doNotAdjustText(replaceHelperCompanyCommand)
lazy val helperCompanyHowToResetText = howToResetText(replaceHelperCompanyCommand)
